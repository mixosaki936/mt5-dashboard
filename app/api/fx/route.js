// USD -> THB, for the dashboard's currency switch.
//
// Only used when the MT5 side did not send a rate of its own: a broker that
// quotes USDTHB gives the live market rate, which beats any of these. Both
// sources below are free, need no API key and publish about once a day, so one
// lookup an hour is plenty — and it keeps a warm lambda from hammering them.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TTL_MS = 60 * 60 * 1000;
let cached = null; // { rate, source, at, fetchedAt }

const SOURCES = [
  {
    name: "ECB / frankfurter.dev",
    url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB",
    read: (j) => ({ rate: j?.rates?.THB, at: j?.date }),
  },
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/USD",
    read: (j) => ({ rate: j?.rates?.THB, at: j?.time_last_update_utc }),
  },
];

async function lookup() {
  const errors = [];
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rate, at } = src.read(await res.json());
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("no THB rate in response");
      return { rate: Math.round(rate * 10000) / 10000, source: src.name, at: at || null };
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

export async function GET() {
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS;
  if (fresh) {
    return NextResponse.json({ ...cached, cached: true }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const next = await lookup();
    cached = { ...next, fetchedAt: Date.now() };
    return NextResponse.json({ ...cached, cached: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[fx] lookup failed:", e.message);
    // A stale rate still beats no rate — say so rather than dropping to nothing.
    if (cached) {
      return NextResponse.json({ ...cached, cached: true, stale: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: e.message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
