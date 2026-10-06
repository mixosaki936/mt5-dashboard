// Snapshot storage — one entry per MT5 account.
//
// - If Vercel KV / Upstash Redis env vars exist, data is persisted there
//   (survives cold starts, works across serverless instances).
// - Otherwise an in-memory stand-in with the same commands is used, which is
//   fine for local dev but is lost when Vercel recycles the lambda.
//
// Every reporter posts once a minute, so what each post costs is what decides
// the bill. The layout keeps that to one small read and one small write:
//
//   <prefix>:accounts           hash, one field per account, rewritten on every
//                               post: { v: 2, meta, core, st }
//                               meta  login/name/server — the account picker
//                               core  account + open positions — the live part
//                               st    bookkeeping for the lists below
//   <prefix>:<id>:deals         closed deals — rewritten only when they change
//   <prefix>:<id>:eq5           equity points, one per 5 minutes, last 7 days
//   <prefix>:<id>:eq1h          equity points, one per hour, last year
//   <prefix>:<id>:days          finished days' equity drawdown, one field per day
//
// Equity points are appended, never rewritten, and a reading identical to the
// previous one is held back, so a weekend with nothing open costs nothing.
//
// Older deployments kept everything — equity history included — in one
// <prefix>:<id> blob and re-uploaded all of it every minute. An account still
// in that shape is moved over on its next post, and served as-is until then.
//
// Env: KV_REST_API_URL + KV_REST_API_TOKEN  (Vercel KV / Upstash)

import { dayKey, DEFAULT_OFFSET_MIN } from "./time";

const PREFIX = process.env.SNAPSHOT_KEY || "mt5:snapshot";
const INDEX = `${PREFIX}:accounts`;
const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
export const usingKv = Boolean(URL_ && TOKEN);

const EQ5_CAP = 7 * 288; // 7 days of 5-minute points
const EQ1H_CAP = 366 * 24; // a year of hourly points
const TRIM_SLACK = 200; // let a list run this far over before trimming it back

const legacyKey = (id) => `${PREFIX}:${id}`;
const dealsKey = (id) => `${PREFIX}:${id}:deals`;
const eq5Key = (id) => `${PREFIX}:${id}:eq5`;
const eq1hKey = (id) => `${PREFIX}:${id}:eq1h`;
const daysKey = (id) => `${PREFIX}:${id}:days`;

/** Logins are numeric in practice, but keep the key shape predictable anyway. */
function loginKey(login) {
  const s = String(login ?? "").trim();
  if (!s || s === "—") return "unknown";
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

const byNewest = (list) =>
  list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

function parse(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** HGETALL arrives as a flat [field, value, ...] array (or an object from some clients). */
function hashEntries(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) return Object.entries(raw);
  const out = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
  return out;
}

// ---------------------------------------------------------------------------
// Redis access: every call is one pipeline (one HTTP round trip to Upstash).

async function kvPipeline(cmds) {
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${res.status}: ${await res.text()}`);
  const out = await res.json();
  return out.map((r, i) => {
    if (r && r.error) throw new Error(`KV ${cmds[i][0]}: ${r.error}`);
    return r ? r.result : null;
  });
}

// The handful of commands this module uses, over plain Maps — local dev without
// KV, and the tests, run the exact same code path as production.
const mem =
  globalThis.__mt5_kv__ || (globalThis.__mt5_kv__ = { strings: new Map(), hashes: new Map(), lists: new Map() });

function memCommand([cmd, key, ...args]) {
  const h = () => mem.hashes.get(key) || mem.hashes.set(key, new Map()).get(key);
  const l = () => mem.lists.get(key) || mem.lists.set(key, []).get(key);
  const range = (arr, a, b) => {
    const n = arr.length;
    let s = Number(a) < 0 ? Math.max(n + Number(a), 0) : Number(a);
    let e = Number(b) < 0 ? n + Number(b) : Math.min(Number(b), n - 1);
    return s > e ? [] : arr.slice(s, e + 1);
  };
  switch (cmd) {
    case "GET": return mem.strings.has(key) ? mem.strings.get(key) : null;
    case "SET": mem.strings.set(key, String(args[0])); return "OK";
    case "DEL": {
      const had = mem.strings.delete(key) || mem.hashes.delete(key) || mem.lists.delete(key);
      return had ? 1 : 0;
    }
    case "HGET": return mem.hashes.get(key)?.get(args[0]) ?? null;
    case "HSET": {
      const m = h();
      let added = 0;
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (!m.has(args[i])) added += 1;
        m.set(args[i], String(args[i + 1]));
      }
      return added;
    }
    case "HGETALL": return [...(mem.hashes.get(key) || new Map())].flat();
    case "RPUSH": { const arr = l(); arr.push(...args.map(String)); return arr.length; }
    case "LRANGE": return range(mem.lists.get(key) || [], args[0], args[1]);
    case "LTRIM": { mem.lists.set(key, range(l(), args[0], args[1])); return "OK"; }
    default: throw new Error(`memory store: ${cmd} not supported`);
  }
}

async function memPipeline(cmds) {
  return cmds.map(memCommand);
}

/** Swappable so the tests can count what each operation costs. */
export const db = { run: usingKv ? kvPipeline : memPipeline };

// ---------------------------------------------------------------------------
// Equity points are stored as "t,equity,balance" — t in epoch seconds.

const r2 = (n) => Math.round(n * 100) / 100;
const encode = (t, e, b) => `${t},${e},${b}`;
const sameReading = (a, b) => a.slice(a.indexOf(",")) === b.slice(b.indexOf(","));
function decode(s) {
  const [t, e, b] = String(s).split(",").map(Number);
  return [t, e, b];
}

/**
 * One point per time bucket. A reading equal to the last stored one is held
 * back; when the value finally moves, the held one goes in first so the chart
 * shows a flat stretch and then a step, not a slow diagonal across the gap.
 */
function bucketed(st, k, t, size, enc, out) {
  const s = st[k] || (st[k] = { b: null, last: null, pending: null });
  const bucket = Math.floor(t / size);
  // `b` is the bucket of the last *stored* point: a reading only held back
  // doesn't use its bucket up, or the move that ends a flat stretch would be
  // dropped whenever it lands in the same five minutes.
  if (bucket === s.b) return;
  if (s.last && sameReading(s.last, enc)) {
    s.pending = enc;
    return;
  }
  if (s.pending) out.push(s.pending);
  out.push(enc);
  s.b = bucket;
  s.last = enc;
  s.pending = null;
}

/**
 * Folds one equity reading into the stored state: the two point lists, and the
 * running drawdown of the current market day, which is filed away under its
 * date once the next day's first reading arrives.
 */
function applyPoint(st, point, offsetMin, out) {
  const t = Math.floor(Date.parse(point.t) / 1000);
  if (!Number.isFinite(t) || (st.seenT && t <= st.seenT)) return; // replayed or out of order
  const e = r2(Number(point.equity) || 0);
  const b = r2(Number(point.balance) || 0);
  const enc = encode(t, e, b);

  bucketed(st, "f", t, 300, enc, out.eq5);
  bucketed(st, "h", t, 3600, enc, out.eq1h);

  const day = dayKey(new Date(t * 1000), offsetMin);
  let a = st.agg;
  if (a && a.day !== day) {
    out.days.push(a.day, JSON.stringify(a));
    a = null;
  }
  if (!a) a = st.agg = { day, from: t, open: e, peak: e, low: e, dd: 0, ddPct: 0, float: r2(e - b) };
  a.to = t;
  a.close = e;
  if (e > a.peak) a.peak = e;
  const drop = r2(a.peak - e);
  if (drop > a.dd) a.dd = drop;
  const pct = a.peak > 0 ? r2((drop / a.peak) * 100) : 0;
  if (pct > a.ddPct) a.ddPct = pct;
  if (e < a.low) a.low = e;
  const float = r2(e - b);
  if (float < a.float) a.float = float;

  st.seenT = t;
  st.seen = enc;
}

/** Cheap fingerprint: closed deals only ever grow, so count + newest is enough. */
function dealsSig(deals = []) {
  if (!deals.length) return "0";
  const last = deals[deals.length - 1];
  const net = deals.reduce((s, d) => s + (d.profit || 0) + (d.swap || 0) + (d.commission || 0), 0);
  return `${deals.length}:${last.ticket ?? ""}:${last.closeTime ?? ""}:${r2(net)}`;
}

// ---------------------------------------------------------------------------

function metaOf(snapshot, id) {
  const acc = snapshot?.account || {};
  return {
    login: acc.login ?? id,
    name: acc.name || "",
    server: acc.server || "",
    currency: acc.currency || "USD",
    updatedAt: snapshot?.updatedAt || new Date().toISOString(),
  };
}

const coreOf = (s) => ({
  updatedAt: s.updatedAt,
  usdThb: s.usdThb ?? null,
  account: s.account || {},
  positions: s.positions || [],
});

const offsetOf = (account) =>
  Number.isFinite(account?.serverOffsetMin) ? account.serverOffsetMin : DEFAULT_OFFSET_MIN;

/**
 * Stores one report. Costs one small read (the account's own index field) and
 * one write pipeline; the deal list is only re-sent when it changed.
 */
export async function ingest(snapshot) {
  const id = loginKey(snapshot?.account?.login);
  const meta = metaOf(snapshot, id);
  const [prevRaw] = await db.run([["HGET", INDEX, id]]);
  const prev = parse(prevRaw);

  const cmds = [];
  const out = { eq5: [], eq1h: [], days: [] };
  let st;
  let migrated = false;

  if (prev?.v === 2) {
    st = prev.st || {};
  } else {
    // First post since the layout changed: carry the old blob's equity history
    // and deals over, then drop the blob.
    st = {};
    const [blob] = await db.run([["GET", legacyKey(id)]]);
    const old = parse(blob);
    if (old) {
      for (const p of old.equityHistory || []) applyPoint(st, p, offsetOf(old.account), out);
      if (old.deals?.length) {
        cmds.push(["SET", dealsKey(id), JSON.stringify(old.deals)]);
        st.dealsSig = dealsSig(old.deals);
      }
      cmds.push(["DEL", legacyKey(id)]);
      migrated = true;
    }
  }

  const sig = dealsSig(snapshot.deals);
  if (sig !== st.dealsSig) {
    cmds.push(["SET", dealsKey(id), JSON.stringify(snapshot.deals || [])]);
    st.dealsSig = sig;
  }

  // A sender may post a batch of points; otherwise this report is the point.
  const acc = snapshot.account || {};
  const incoming = snapshot.equityHistory?.length
    ? snapshot.equityHistory
    : [{ t: meta.updatedAt, equity: acc.equity, balance: acc.balance }];
  for (const p of incoming) applyPoint(st, p, offsetOf(acc), out);

  const pushes = [];
  if (out.eq5.length) pushes.push([eq5Key(id), EQ5_CAP, cmds.push(["RPUSH", eq5Key(id), ...out.eq5]) - 1]);
  if (out.eq1h.length) pushes.push([eq1hKey(id), EQ1H_CAP, cmds.push(["RPUSH", eq1hKey(id), ...out.eq1h]) - 1]);
  if (out.days.length) cmds.push(["HSET", daysKey(id), ...out.days]);
  cmds.push(["HSET", INDEX, id, JSON.stringify({ v: 2, meta, core: coreOf(snapshot), st })]);

  const res = await db.run(cmds);

  // RPUSH answers with the new length — trim only once a list has run well over.
  const trims = pushes
    .filter(([, cap, at]) => Number(res[at]) > cap + TRIM_SLACK)
    .map(([key, cap]) => ["LTRIM", key, -cap, -1]);
  if (trims.length) await db.run(trims);

  return { persisted: usingKv ? "kv" : "memory", account: meta.login, migrated };
}

/**
 * The account list plus one account's report (without equity history).
 * Without a login, the account that reported most recently.
 */
export async function readReport(login) {
  const [all] = await db.run([["HGETALL", INDEX]]);
  const records = new Map();
  for (const [id, v] of hashEntries(all)) {
    const r = parse(v);
    if (r) records.set(id, r);
  }
  const accounts = byNewest([...records.values()].map((r) => (r.v === 2 ? r.meta : r)));

  const id = login ? loginKey(login) : accounts[0] ? loginKey(accounts[0].login) : null;
  const rec = id ? records.get(id) : null;
  if (!rec) return { accounts, report: null };

  if (rec.v === 2) {
    const [deals] = await db.run([["GET", dealsKey(id)]]);
    return { accounts, report: { ...rec.core, deals: parse(deals) || [] } };
  }

  // Not moved over yet (its reporter hasn't posted since the change).
  const [blob] = await db.run([["GET", legacyKey(id)]]);
  const old = parse(blob);
  if (!old) return { accounts, report: null };
  const { equityHistory, ...rest } = old;
  return { accounts, report: rest };
}

/**
 * Equity history for the chart: hourly points for the long view, 5-minute
 * points for the last week, plus each finished day's equity drawdown and the
 * running one for today. Points come back as [epochSec, equity, balance].
 */
export async function readEquity(login) {
  const id = loginKey(login);
  const [recRaw, fine, coarse, daysRaw] = await db.run([
    ["HGET", INDEX, id],
    ["LRANGE", eq5Key(id), -EQ5_CAP, -1],
    ["LRANGE", eq1hKey(id), 0, -1],
    ["HGETALL", daysKey(id)],
  ]);
  const rec = parse(recRaw);
  if (!rec) return null;

  if (rec.v !== 2) {
    const [blob] = await db.run([["GET", legacyKey(id)]]);
    const old = parse(blob);
    const points = (old?.equityHistory || [])
      .map((p) => [Math.floor(Date.parse(p.t) / 1000), p.equity, p.balance])
      .filter((p) => Number.isFinite(p[0]));
    return { points, days: {}, today: null };
  }

  const recent = (fine || []).map(decode);
  const cut = recent.length ? recent[0][0] : Infinity;
  const points = [...(coarse || []).map(decode).filter((p) => p[0] < cut), ...recent];
  // A held-back flat stretch still has to reach the latest reading.
  if (rec.st?.seen) {
    const latest = decode(rec.st.seen);
    if (!points.length || latest[0] > points[points.length - 1][0]) points.push(latest);
  }

  const days = {};
  for (const [day, v] of hashEntries(daysRaw)) {
    const a = parse(v);
    if (a) days[day] = a;
  }
  return { points, days, today: rec.st?.agg || null };
}
