// Normalises whatever the MT5 side sends (camelCase or snake_case) into one
// canonical snapshot shape used by the whole dashboard.

const num = (v, d = 0) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : d;
};

const pick = (o, ...keys) => {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return undefined;
};

// MT5 sends times as seconds-epoch, "2026-09-15 10:22:31" or ISO. Normalise to ISO.
export function toIso(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return toIso(parseInt(s, 10));
  // "2026.09.15 10:22:31" (MT5 style) or "2026-09-15 10:22:31"
  const m = s.match(
    /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return new Date(
      Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0))
    ).toISOString();
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Minutes the broker's server clock runs ahead of UTC, if the bridge said so.
 * `null` (not 0) when unknown, so the dashboard can fall back to its default
 * instead of silently treating an unreported broker as GMT+0.
 */
function serverOffsetMin(...sources) {
  for (const src of sources) {
    const mins = pick(src, "tzOffsetMin", "serverOffsetMin", "server_offset_min", "tz_offset_min");
    if (mins !== undefined) {
      const n = num(mins, NaN);
      if (Number.isFinite(n)) return Math.round(n);
    }
    const secs = pick(src, "tzOffsetSec", "tz_offset_sec", "tzOffset", "tz_offset");
    if (secs !== undefined) {
      const n = num(secs, NaN);
      if (Number.isFinite(n)) return Math.round(n / 60);
    }
  }
  return null;
}

const normType = (v) => {
  const s = String(v ?? "").toUpperCase();
  if (s.includes("SELL") || s === "1" || s === "S") return "SELL";
  return "BUY";
};

function normPosition(p) {
  return {
    ticket: pick(p, "ticket", "id", "position", "position_id") ?? null,
    symbol: String(pick(p, "symbol", "pair", "instrument") ?? "UNKNOWN").trim(),
    type: normType(pick(p, "type", "side", "direction", "cmd")),
    volume: num(pick(p, "volume", "lots", "lot", "size")),
    openPrice: num(pick(p, "openPrice", "open_price", "priceOpen", "price_open")),
    currentPrice: num(
      pick(p, "currentPrice", "current_price", "priceCurrent", "price_current")
    ),
    sl: num(pick(p, "sl", "stopLoss", "stop_loss")),
    tp: num(pick(p, "tp", "takeProfit", "take_profit")),
    profit: num(pick(p, "profit", "pl", "pnl")),
    swap: num(pick(p, "swap")),
    commission: num(pick(p, "commission", "fee")),
    openTime: toIso(pick(p, "openTime", "open_time", "time", "timeSetup")),
    magic: num(pick(p, "magic", "magicNumber", "magic_number")),
    comment: String(pick(p, "comment", "ea", "label") ?? ""),
  };
}

function normDeal(d) {
  return {
    ticket: pick(d, "ticket", "id", "deal") ?? null,
    positionId: pick(d, "positionId", "position_id", "position") ?? null,
    symbol: String(pick(d, "symbol", "pair", "instrument") ?? "UNKNOWN").trim(),
    type: normType(pick(d, "type", "side", "direction", "cmd")),
    volume: num(pick(d, "volume", "lots", "lot", "size")),
    openPrice: num(pick(d, "openPrice", "open_price", "priceOpen", "price_open")),
    closePrice: num(
      pick(d, "closePrice", "close_price", "priceClose", "price_close", "price")
    ),
    sl: num(pick(d, "sl", "stopLoss", "stop_loss")),
    tp: num(pick(d, "tp", "takeProfit", "take_profit")),
    profit: num(pick(d, "profit", "pl", "pnl")),
    swap: num(pick(d, "swap")),
    commission: num(pick(d, "commission", "fee")),
    openTime: toIso(pick(d, "openTime", "open_time", "timeOpen")),
    closeTime: toIso(
      pick(d, "closeTime", "close_time", "timeClose", "time")
    ),
    magic: num(pick(d, "magic", "magicNumber", "magic_number")),
    comment: String(pick(d, "comment", "ea", "label") ?? ""),
  };
}

export function normalizeSnapshot(raw) {
  const body = raw || {};
  const a = body.account || body.acc || body;
  const tzOffsetMin = serverOffsetMin(a, body);
  // A broker that quotes USDTHB gives the live rate; null means "look it up".
  const usdThb = num(pick(body, "usdThb", "usd_thb") ?? pick(a, "usdThb", "usd_thb"), 0) || null;

  const balance = num(pick(a, "balance", "Balance"));
  const equity = num(pick(a, "equity", "Equity"), balance);

  const deals = (body.deals || body.history || body.closed || [])
    .map(normDeal)
    .filter((d) => d.symbol)
    .sort((x, y) => (x.closeTime || "").localeCompare(y.closeTime || ""));

  const positions = (body.positions || body.open || body.trades || [])
    .map(normPosition)
    .filter((p) => p.symbol);

  const netClosed = deals.reduce(
    (s, d) => s + d.profit + d.swap + d.commission,
    0
  );

  const account = {
    login: pick(a, "login", "account", "accountNumber", "account_number") ?? "—",
    name: String(pick(a, "name", "owner", "holder") ?? ""),
    server: String(pick(a, "server", "broker") ?? ""),
    company: String(pick(a, "company") ?? ""),
    currency: String(pick(a, "currency") ?? "USD"),
    leverage: num(pick(a, "leverage"), 0),
    balance,
    equity,
    credit: num(pick(a, "credit")),
    margin: num(pick(a, "margin")),
    freeMargin: num(pick(a, "freeMargin", "free_margin", "marginFree")),
    marginLevel: num(pick(a, "marginLevel", "margin_level", "margin_level_pct")),
    initialDeposit: num(
      pick(a, "initialDeposit", "initial_deposit", "deposit", "initial"),
      Math.round((balance - netClosed) * 100) / 100
    ),
    // Market time on the dashboard = this offset applied to the stored UTC.
    serverOffsetMin: tzOffsetMin,
  };

  const equityHistory = (body.equityHistory || body.equity_history || [])
    .map((e) => ({
      t: toIso(pick(e, "t", "time", "timestamp", "date")),
      equity: num(pick(e, "equity", "e")),
      balance: num(pick(e, "balance", "b")),
    }))
    .filter((e) => e.t)
    .sort((x, y) => x.t.localeCompare(y.t));

  return {
    updatedAt:
      toIso(pick(body, "updatedAt", "updated_at", "time", "timestamp")) ||
      new Date().toISOString(),
    usdThb,
    account,
    positions,
    deals,
    equityHistory,
  };
}
