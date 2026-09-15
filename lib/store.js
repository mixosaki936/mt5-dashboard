// Snapshot storage — one entry per MT5 account.
//
// - If Vercel KV / Upstash Redis env vars exist, snapshots are persisted there
//   (survives cold starts, works across serverless instances).
// - Otherwise they fall back to process memory, which is fine for local dev but
//   will be lost when Vercel recycles the lambda.
//
// Keys: `<prefix>:<login>` holds one account's snapshot and `<prefix>:accounts`
// is a hash of login -> meta used to build the account picker. The index is a
// hash rather than one JSON blob so two machines reporting at the same time
// each touch their own field instead of clobbering the other's.
//
// Env: KV_REST_API_URL + KV_REST_API_TOKEN  (Vercel KV / Upstash)

const PREFIX = process.env.SNAPSHOT_KEY || "mt5:snapshot";
const INDEX = `${PREFIX}:accounts`;
const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
export const usingKv = Boolean(URL_ && TOKEN);

const mem =
  globalThis.__mt5_store__ ||
  (globalThis.__mt5_store__ = { snapshots: {}, index: {} });

/** Logins are numeric in practice, but keep the key shape predictable anyway. */
function loginKey(login) {
  const s = String(login ?? "").trim();
  if (!s || s === "—") return "unknown";
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

const accountKey = (id) => `${PREFIX}:${id}`;

const byNewest = (list) =>
  list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

async function kv(command) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${res.status}: ${await res.text()}`);
  return res.json();
}

/** [{ login, name, server, currency, updatedAt }], most recently reported first. */
export async function listAccounts() {
  if (!usingKv) return byNewest(Object.values(mem.index));
  try {
    const out = await kv(["HGETALL", INDEX]);
    const raw = out?.result;
    // Upstash returns a flat [field, value, ...] array; some clients send an object.
    const values = Array.isArray(raw)
      ? raw.filter((_, i) => i % 2 === 1)
      : Object.values(raw || {});
    const list = [];
    for (const v of values) {
      try {
        list.push(typeof v === "string" ? JSON.parse(v) : v);
      } catch {
        // skip a corrupt index row rather than breaking the whole picker
      }
    }
    return byNewest(list);
  } catch (e) {
    console.error("[store] account list failed:", e.message);
    return byNewest(Object.values(mem.index));
  }
}

/** Without a login, falls back to whichever account reported most recently. */
export async function readSnapshot(login) {
  let id = login ? loginKey(login) : null;
  if (!id) {
    const accounts = await listAccounts();
    if (!accounts.length) return null;
    id = loginKey(accounts[0].login);
  }
  if (!usingKv) return mem.snapshots[id] || null;
  try {
    const out = await kv(["GET", accountKey(id)]);
    return out?.result ? JSON.parse(out.result) : null;
  } catch (e) {
    console.error("[store] read failed:", e.message);
    return mem.snapshots[id] || null;
  }
}

export async function writeSnapshot(snapshot) {
  const acc = snapshot?.account || {};
  const id = loginKey(acc.login);
  const meta = {
    login: acc.login ?? id,
    name: acc.name || "",
    server: acc.server || "",
    currency: acc.currency || "USD",
    updatedAt: snapshot?.updatedAt || new Date().toISOString(),
  };

  mem.snapshots[id] = snapshot;
  mem.index[id] = meta;
  if (!usingKv) return { persisted: "memory", account: meta.login };

  try {
    await kv(["SET", accountKey(id), JSON.stringify(snapshot)]);
    await kv(["HSET", INDEX, id, JSON.stringify(meta)]);
    return { persisted: "kv", account: meta.login };
  } catch (e) {
    console.error("[store] write failed:", e.message);
    return { persisted: "memory", account: meta.login, error: e.message };
  }
}

const MAX_POINTS = 5000;

/** Keeps a rolling equity curve even when the sender only posts a live snapshot. */
export function mergeEquityHistory(previous, next) {
  // Snapshots are stored per account, so this only guards against a login being
  // reused for a different account.
  const sameAccount =
    previous && String(previous.account?.login) === String(next.account?.login);
  const old = sameAccount ? previous.equityHistory || [] : [];
  const incoming = next.equityHistory || [];
  let merged;
  if (incoming.length) {
    const seen = new Set(incoming.map((p) => p.t));
    merged = [...old.filter((p) => !seen.has(p.t)), ...incoming];
  } else {
    const last = old[old.length - 1];
    const point = {
      t: next.updatedAt,
      equity: next.account.equity,
      balance: next.account.balance,
    };
    const same =
      last &&
      last.equity === point.equity &&
      last.balance === point.balance &&
      new Date(point.t) - new Date(last.t) < 60_000;
    merged = same ? old : [...old, point];
  }
  merged.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  return merged.slice(-MAX_POINTS);
}
