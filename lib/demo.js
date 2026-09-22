// Deterministic demo snapshot so the dashboard has something to show before the
// first real POST from MT5. Disable with DEMO_DATA=off.

import { normalizeSnapshot } from "./normalize";

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYMBOLS = [
  { symbol: "XAUUSD", price: 3320, tick: 1.2, magic: 20250101, ea: "GoldScalperSMC", edge: 0.62, avgWin: 34, avgLoss: 21, freq: 3.1 },
  { symbol: "EURUSD", price: 1.0864, tick: 0.0012, magic: 20250102, ea: "SMC-FX", edge: 0.55, avgWin: 18, avgLoss: 15, freq: 1.6 },
  { symbol: "GBPUSD", price: 1.2712, tick: 0.0015, magic: 20250102, ea: "SMC-FX", edge: 0.51, avgWin: 22, avgLoss: 20, freq: 1.1 },
  { symbol: "USDJPY", price: 152.4, tick: 0.18, magic: 20250103, ea: "SMC-FX", edge: 0.48, avgWin: 17, avgLoss: 19, freq: 0.8 },
];

export function demoSnapshot(now = Date.now()) {
  const rnd = mulberry32(20260915);
  const days = 75;
  const deals = [];
  let ticket = 500100;

  for (const s of SYMBOLS) {
    for (let d = days; d >= 0; d--) {
      const dayStart = now - d * 864e5;
      const dow = new Date(dayStart).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const n = Math.round(s.freq * (0.4 + rnd() * 1.6));
      for (let i = 0; i < n; i++) {
        const hour = 7 + Math.floor(rnd() * 12);
        const openT = new Date(dayStart).setUTCHours(hour, Math.floor(rnd() * 59), 0, 0);
        const holdMin = 8 + Math.floor(rnd() * 140);
        const closeT = openT + holdMin * 60000;
        if (closeT > now) continue;
        const win = rnd() < s.edge;
        const mag = 0.45 + rnd() * 1.5;
        const gross = win ? s.avgWin * mag : -s.avgLoss * mag;
        const type = rnd() > 0.5 ? "BUY" : "SELL";
        const volume = Math.round((0.05 + rnd() * 0.25) * 100) / 100;
        const openPrice = s.price * (1 + (rnd() - 0.5) * 0.02);
        const move = s.tick * (win ? 1 : -1) * (0.6 + rnd());
        deals.push({
          ticket: ticket++,
          positionId: ticket,
          symbol: s.symbol,
          type,
          volume,
          openPrice: +openPrice.toFixed(s.symbol === "XAUUSD" ? 2 : 5),
          closePrice: +(openPrice + (type === "BUY" ? move : -move)).toFixed(
            s.symbol === "XAUUSD" ? 2 : 5
          ),
          profit: Math.round(gross * 100) / 100,
          swap: Math.round(-rnd() * 0.6 * 100) / 100,
          commission: -Math.round(volume * 7 * 100) / 100,
          openTime: new Date(openT).toISOString(),
          closeTime: new Date(closeT).toISOString(),
          magic: s.magic,
          comment: s.ea,
        });
      }
    }
  }

  deals.sort((a, b) => a.closeTime.localeCompare(b.closeTime));

  const positions = [
    { s: SYMBOLS[0], type: "BUY", volume: 0.15, profit: 42.8, mins: 37 },
    { s: SYMBOLS[0], type: "BUY", volume: 0.1, profit: -18.4, mins: 96 },
    { s: SYMBOLS[1], type: "SELL", volume: 0.2, profit: 11.2, mins: 210 },
  ].map((p, i) => ({
    ticket: 600200 + i,
    symbol: p.s.symbol,
    type: p.type,
    volume: p.volume,
    openPrice: +(p.s.price * 0.999).toFixed(p.s.symbol === "XAUUSD" ? 2 : 5),
    currentPrice: +(p.s.price * (1 + (p.profit > 0 ? 0.0006 : -0.0004))).toFixed(
      p.s.symbol === "XAUUSD" ? 2 : 5
    ),
    sl: +(p.s.price * 0.995).toFixed(p.s.symbol === "XAUUSD" ? 2 : 5),
    tp: +(p.s.price * 1.008).toFixed(p.s.symbol === "XAUUSD" ? 2 : 5),
    profit: p.profit,
    swap: -0.3,
    commission: -(p.volume * 7),
    openTime: new Date(now - p.mins * 60000).toISOString(),
    magic: p.s.magic,
    comment: p.s.ea,
  }));

  const initial = 10000;
  const netClosed = deals.reduce((s, d) => s + d.profit + d.swap + d.commission, 0);
  const floating = positions.reduce((s, p) => s + p.profit + p.swap + p.commission, 0);
  const balance = Math.round((initial + netClosed) * 100) / 100;

  // rolling equity history, one point per closed deal
  let run = initial;
  const equityHistory = deals.map((d) => {
    run += d.profit + d.swap + d.commission;
    return { t: d.closeTime, balance: Math.round(run * 100) / 100, equity: Math.round(run * 100) / 100 };
  });
  equityHistory.push({
    t: new Date(now).toISOString(),
    balance,
    equity: Math.round((balance + floating) * 100) / 100,
  });

  return normalizeSnapshot({
    updatedAt: new Date(now).toISOString(),
    demo: true,
    account: {
      login: 5090211,
      name: "Demo Portfolio",
      server: "MetaQuotes-Demo",
      company: "MetaQuotes Ltd.",
      currency: "USD",
      leverage: 500,
      balance,
      equity: Math.round((balance + floating) * 100) / 100,
      margin: 412.5,
      freeMargin: Math.round((balance + floating - 412.5) * 100) / 100,
      marginLevel: Math.round(((balance + floating) / 412.5) * 10000) / 100,
      initialDeposit: initial,
      tzOffsetMin: 180, // a typical MetaQuotes-Demo clock: GMT+3
    },
    positions,
    deals,
    equityHistory,
  });
}
