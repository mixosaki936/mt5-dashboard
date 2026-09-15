import { NextResponse } from "next/server";
import { normalizeSnapshot } from "@/lib/normalize";
import {
  listAccounts,
  readSnapshot,
  writeSnapshot,
  mergeEquityHistory,
  usingKv,
} from "@/lib/store";
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

export async function GET(req) {
  const url = new URL(req.url);
  // No ?account= -> whichever account reported most recently.
  const requested = url.searchParams.get("account");
  const accounts = await listAccounts();
  const stored = await readSnapshot(requested);
  const demoOn = process.env.DEMO_DATA !== "off";

  if (url.searchParams.get("demo") === "1" || (!stored && demoOn)) {
    return json({ ...demoSnapshot(), accounts, source: "demo" });
  }
  if (!stored) {
    return json({ empty: true, account: {}, positions: [], deals: [], equityHistory: [], accounts });
  }
  return json({ ...stored, accounts, source: usingKv ? "kv" : "memory" });
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

  // Merge against this account's own history, not whoever posted last.
  const previous = await readSnapshot(snapshot.account.login);
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
