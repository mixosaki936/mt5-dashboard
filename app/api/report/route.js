import { NextResponse } from "next/server";
import { normalizeSnapshot } from "@/lib/normalize";
import { readSnapshot, writeSnapshot, mergeEquityHistory, usingKv } from "@/lib/store";
import { demoSnapshot } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Auth-Token,Authorization",
};

function authorised(req, url) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return true; // no token configured -> open (dev only)
  const given =
    req.headers.get("x-auth-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("token");
  return given === expected;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req) {
  const url = new URL(req.url);
  const stored = await readSnapshot();
  const demoOn = process.env.DEMO_DATA !== "off";

  if (!stored && (demoOn || url.searchParams.get("demo") === "1")) {
    return NextResponse.json(
      { ...demoSnapshot(), source: "demo" },
      { headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  }
  if (url.searchParams.get("demo") === "1") {
    return NextResponse.json(
      { ...demoSnapshot(), source: "demo" },
      { headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    stored
      ? { ...stored, source: usingKv ? "kv" : "memory" }
      : { empty: true, account: {}, positions: [], deals: [], equityHistory: [] },
    { headers: { ...CORS, "Cache-Control": "no-store" } }
  );
}

export async function POST(req) {
  const url = new URL(req.url);
  if (!authorised(req, url)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401, headers: CORS });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    // MT5 WebRequest sometimes posts without a JSON content-type
    try {
      body = JSON.parse(await req.text());
    } catch (e) {
      return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400, headers: CORS });
    }
  }

  let snapshot;
  try {
    snapshot = normalizeSnapshot(body);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400, headers: CORS });
  }

  const previous = await readSnapshot();
  snapshot.equityHistory = mergeEquityHistory(previous, snapshot);
  const result = await writeSnapshot(snapshot);

  return NextResponse.json(
    {
      ok: true,
      storedAt: snapshot.updatedAt,
      positions: snapshot.positions.length,
      deals: snapshot.deals.length,
      symbols: [...new Set(snapshot.deals.map((d) => d.symbol))],
      ...result,
    },
    { headers: CORS }
  );
}
