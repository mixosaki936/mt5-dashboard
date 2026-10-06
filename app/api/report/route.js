import { NextResponse } from "next/server";
import { normalizeSnapshot } from "@/lib/normalize";
import { ingest, readReport, usingKv } from "@/lib/store";
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

const json = (body) =>
  NextResponse.json(body, { headers: { ...CORS, "Cache-Control": "no-store" } });

// Equity history is not part of this response — the chart fetches it from
// /api/equity on a slower cycle, so this once-a-minute poll stays small.
export async function GET(req) {
  const url = new URL(req.url);
  // No ?account= -> whichever account reported most recently.
  const requested = url.searchParams.get("account");
  let accounts, report;
  try {
    ({ accounts, report } = await readReport(requested));
  } catch (e) {
    console.error("[report] read failed:", e.message);
    return NextResponse.json({ error: e.message }, { status: 502, headers: CORS });
  }
  const demoOn = process.env.DEMO_DATA !== "off";

  if (url.searchParams.get("demo") === "1" || (!report && demoOn)) {
    const { equityHistory, ...demo } = demoSnapshot();
    return json({ ...demo, accounts, source: "demo" });
  }
  if (!report) {
    return json({ empty: true, account: {}, positions: [], deals: [], accounts });
  }
  return json({ ...report, accounts, source: usingKv ? "kv" : "memory" });
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

  let result;
  try {
    result = await ingest(snapshot);
  } catch (e) {
    console.error("[report] store failed:", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 502, headers: CORS });
  }

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
