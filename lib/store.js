// Snapshot storage.
//
// - If Vercel KV / Upstash Redis env vars exist, the snapshot is persisted there
//   (survives cold starts, works across serverless instances).
// - Otherwise it falls back to process memory, which is fine for local dev but
//   will be lost when Vercel recycles the lambda.
//
// Env: KV_REST_API_URL + KV_REST_API_TOKEN  (Vercel KV / Upstash)

const KEY = process.env.SNAPSHOT_KEY || "mt5:snapshot";
const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
export const usingKv = Boolean(URL_ && TOKEN);

const mem = globalThis.__mt5_store__ || (globalThis.__mt5_store__ = { snapshot: null });

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

export async function readSnapshot() {
  if (!usingKv) return mem.snapshot;
  try {
    const out = await kv(["GET", KEY]);
    return out?.result ? JSON.parse(out.result) : null;
  } catch (e) {
    console.error("[store] read failed:", e.message);
    return mem.snapshot;
  }
}

export async function writeSnapshot(snapshot) {
  mem.snapshot = snapshot;
  if (!usingKv) return { persisted: "memory" };
  try {
    await kv(["SET", KEY, JSON.stringify(snapshot)]);
    return { persisted: "kv" };
  } catch (e) {
    console.error("[store] write failed:", e.message);
    return { persisted: "memory", error: e.message };
  }
}

const MAX_POINTS = 5000;

/** Keeps a rolling equity curve even when the sender only posts a live snapshot. */
export function mergeEquityHistory(previous, next) {
  // A different account (or the first report) starts its own curve.
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
