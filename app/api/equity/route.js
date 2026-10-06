// Equity history for the growth chart, kept out of /api/report so the
// once-a-minute poll stays small. The page asks for this far less often.

import { NextResponse } from "next/server";
import { readEquity } from "@/lib/store";
import { demoSnapshot } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req) {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const demoOn = process.env.DEMO_DATA !== "off";

  let equity = null;
  if (account && url.searchParams.get("demo") !== "1") {
    try {
      equity = await readEquity(account);
    } catch (e) {
      console.error("[equity] read failed:", e.message);
      return json({ error: e.message }, 502);
    }
  }

  if (!equity && demoOn) {
    const points = demoSnapshot().equityHistory.map((p) => [
      Math.floor(Date.parse(p.t) / 1000),
      p.equity,
      p.balance,
    ]);
    return json({ points, days: {}, today: null, source: "demo" });
  }
  return json(equity || { points: [], days: {}, today: null });
}
