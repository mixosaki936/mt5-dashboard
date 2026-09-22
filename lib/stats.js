// All derived numbers: portfolio-wide and per symbol.
// Everything is computed from the closed deals + open positions of one snapshot.
//
// Deals carry real-UTC timestamps; every calendar bucket below (hour, weekday,
// day, "today", "this month") is cut on market time instead — see lib/time.js.

import { shift, startOfDay, startOfMonth, startOfWeek } from "./time";

export const netOf = (d) => d.profit + d.swap + d.commission;

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const round2 = (n) => Math.round(n * 100) / 100;

/** Max drawdown of a running equity curve (array of numbers). */
function drawdown(curve) {
  let peak = curve.length ? curve[0] : 0;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
    const pct = peak > 0 ? (dd / peak) * 100 : 0;
    if (pct > maxDDPct) maxDDPct = pct;
  }
  return { maxDD: round2(maxDD), maxDDPct: round2(maxDDPct) };
}

function streaks(deals) {
  let w = 0, l = 0, bw = 0, bl = 0;
  for (const d of deals) {
    if (netOf(d) >= 0) {
      w += 1; l = 0;
      if (w > bw) bw = w;
    } else {
      l += 1; w = 0;
      if (l > bl) bl = l;
    }
  }
  return { maxWinStreak: bw, maxLossStreak: bl };
}

/**
 * Core stat block for any set of closed deals.
 * `base` is the equity the curve starts from (account initial deposit for the
 * portfolio; 0 for a single symbol, where the curve is cumulative P/L).
 * `offsetMin` is the market-time offset the calendar buckets are cut on.
 */
export function statsFor(deals, base = 0, ddDenominator = 0, offsetMin = 0) {
  const trades = deals.length;
  const wins = deals.filter((d) => netOf(d) > 0);
  const losses = deals.filter((d) => netOf(d) < 0);
  const grossProfit = sum(wins, netOf);
  const grossLoss = Math.abs(sum(losses, netOf));
  const net = sum(deals, netOf);

  let run = base;
  const curve = deals.map((d) => {
    run += netOf(d);
    return { t: d.closeTime, value: round2(run), net: round2(run - base) };
  });

  const dd = drawdown([base, ...curve.map((c) => c.value)]);
  // For a single symbol the curve starts at 0, so a percentage against its own
  // peak is meaningless — measure it against the account's capital instead.
  if (ddDenominator > 0) dd.maxDDPct = round2((dd.maxDD / ddDenominator) * 100);

  const holdMins = deals
    .filter((d) => d.openTime && d.closeTime)
    .map((d) => (new Date(d.closeTime) - new Date(d.openTime)) / 60000);

  const buys = deals.filter((d) => d.type === "BUY");
  const sells = deals.filter((d) => d.type === "SELL");

  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, net: 0, trades: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, d) => ({ day: d, net: 0, trades: 0 }));
  const byDayMap = new Map();

  for (const d of deals) {
    if (!d.closeTime) continue;
    const dt = shift(d.closeTime, offsetMin);
    if (Number.isNaN(dt.getTime())) continue;
    const h = byHour[dt.getUTCHours()];
    h.net += netOf(d);
    h.trades += 1;
    const w = byWeekday[dt.getUTCDay()];
    w.net += netOf(d);
    w.trades += 1;
    const key = dt.toISOString().slice(0, 10);
    byDayMap.set(key, (byDayMap.get(key) || 0) + netOf(d));
  }

  return {
    trades,
    wins: wins.length,
    losses: losses.length,
    winRate: trades ? round2((wins.length / trades) * 100) : 0,
    net: round2(net),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    avgWin: wins.length ? round2(grossProfit / wins.length) : 0,
    avgLoss: losses.length ? round2(grossLoss / losses.length) : 0,
    rr: losses.length && wins.length
      ? round2((grossProfit / wins.length) / (grossLoss / losses.length))
      : null,
    expectancy: trades ? round2(net / trades) : 0,
    bestTrade: trades ? round2(Math.max(...deals.map(netOf))) : 0,
    worstTrade: trades ? round2(Math.min(...deals.map(netOf))) : 0,
    volume: round2(sum(deals, (d) => d.volume)),
    commission: round2(sum(deals, (d) => d.commission)),
    swap: round2(sum(deals, (d) => d.swap)),
    ...dd,
    ...streaks(deals),
    avgHoldMin: holdMins.length
      ? round2(holdMins.reduce((a, b) => a + b, 0) / holdMins.length)
      : null,
    buy: {
      trades: buys.length,
      net: round2(sum(buys, netOf)),
      winRate: buys.length
        ? round2((buys.filter((d) => netOf(d) > 0).length / buys.length) * 100)
        : 0,
    },
    sell: {
      trades: sells.length,
      net: round2(sum(sells, netOf)),
      winRate: sells.length
        ? round2((sells.filter((d) => netOf(d) > 0).length / sells.length) * 100)
        : 0,
    },
    curve,
    byHour,
    byWeekday,
    byDay: [...byDayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, net]) => ({ date, net: round2(net) })),
  };
}

const RANGE_MS = {
  today: null,
  wtd: null,
  "7d": 7 * 864e5,
  "30d": 30 * 864e5,
  "90d": 90 * 864e5,
  mtd: null,
  all: null,
};

/**
 * When a range begins, as a real-UTC instant — `null` for "all".
 * `today`, `wtd` and `mtd` are cut on the market clock: today starts at the
 * market's midnight (the trading-day rollover) and the week at its Monday, not
 * at the viewer's. The rolling windows (7d/30d/90d) count back from right now.
 */
export function rangeStart(range, now = new Date(), offsetMin = 0) {
  if (!range || range === "all") return null;
  if (range === "today") return startOfDay(now, offsetMin);
  if (range === "wtd") return startOfWeek(now, offsetMin);
  if (range === "mtd") return startOfMonth(now, offsetMin);
  if (RANGE_MS[range]) return new Date(now.getTime() - RANGE_MS[range]);
  return null;
}

export function filterDealsByRange(deals, range, now = new Date(), offsetMin = 0) {
  const from = rangeStart(range, now, offsetMin);
  if (!from) return deals;
  return deals.filter((d) => d.closeTime && new Date(d.closeTime) >= from);
}

/**
 * Full derived model for one snapshot.
 * Returns portfolio stats plus one block per traded symbol.
 */
export function buildModel(snapshot, { range = "all", symbols = null, offsetMin = 0 } = {}) {
  const s = snapshot || { account: {}, deals: [], positions: [], equityHistory: [] };
  const allDeals = s.deals || [];
  const from = rangeStart(range, new Date(), offsetMin);
  let deals = from
    ? allDeals.filter((d) => d.closeTime && new Date(d.closeTime) >= from)
    : allDeals;
  let positions = s.positions || [];

  if (symbols && symbols.length) {
    deals = deals.filter((d) => symbols.includes(d.symbol));
    positions = positions.filter((p) => symbols.includes(p.symbol));
  }

  const account = s.account || {};
  const initial = account.initialDeposit || 0;
  const portfolio = statsFor(deals, initial, 0, offsetMin);

  const floating = round2(sum(positions, (p) => p.profit + p.swap + p.commission));

  const names = [
    ...new Set([...deals.map((d) => d.symbol), ...positions.map((p) => p.symbol)]),
  ].sort();

  const grossPositive = names.reduce((acc, name) => {
    const n = deals
      .filter((d) => d.symbol === name)
      .reduce((s, d) => s + netOf(d), 0);
    return acc + (n > 0 ? n : 0);
  }, 0);

  const bySymbol = names.map((name) => {
    const sd = deals.filter((d) => d.symbol === name);
    const sp = positions.filter((p) => p.symbol === name);
    const st = statsFor(sd, 0, initial, offsetMin);
    const magics = [...new Set([...sd, ...sp].map((x) => x.magic).filter(Boolean))];
    const eas = [
      ...new Set([...sd, ...sp].map((x) => (x.comment || "").trim()).filter(Boolean)),
    ];
    return {
      symbol: name,
      ...st,
      positions: sp,
      deals: sd,
      openLots: round2(sum(sp, (p) => p.volume)),
      floating: round2(sum(sp, (p) => p.profit + p.swap + p.commission)),
      // share of the account's gross winnings (only profitable pairs, sums to 100%)
      shareOfProfit: st.net > 0 && grossPositive > 0 ? round2((st.net / grossPositive) * 100) : 0,
      shareOfNet: portfolio.net !== 0 ? round2((st.net / portfolio.net) * 100) : 0,
      magics,
      eas,
    };
  });

  // Growth is measured over the selected range, so the base is the capital the
  // account carried into it: the deposit plus everything closed before it began.
  // (Positions still open at that point can't be reconstructed, so the base is
  // the balance at the range start, not the equity.)
  const closedBefore = from
    ? sum(
        allDeals.filter((d) => d.closeTime && new Date(d.closeTime) < from),
        netOf
      )
    : 0;
  const base = initial + closedBefore;
  // Floating P/L belongs to the period that is still running, whichever it is —
  // over "all" this stays exactly equity vs initial deposit.
  const growth = base > 0 ? round2(((portfolio.net + floating) / base) * 100) : 0;

  return {
    updatedAt: s.updatedAt,
    account,
    portfolio: {
      ...portfolio,
      floating,
      growth,
      // Capital the growth % is measured against (initial deposit over "all").
      base: round2(base),
      openLots: round2(sum(positions, (p) => p.volume)),
      openCount: positions.length,
    },
    positions,
    deals,
    equityHistory: s.equityHistory || [],
    bySymbol,
    symbolNames: names,
  };
}
