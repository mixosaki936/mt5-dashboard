// Several MT5 accounts seen as one portfolio.
//
// The result has the same shape as a single account's report, so everything
// downstream (buildModel, the calendar, the tables) works on it unchanged:
// money adds up, deals and positions are pooled — each tagged with the login it
// came from — and the initial deposits add up so growth and drawdown are
// measured against the capital of the whole portfolio.

/** The value the account picker and the API use for "all accounts". */
export const ALL = "all";

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Money in different currencies can't be added up, so the total is kept in one
 * of them — USD whenever any account is in USD — and the others are left out.
 */
export function baseCurrency(reports) {
  if (reports.some((r) => r.account?.currency === "USD")) return "USD";
  return reports[0]?.account?.currency || "USD";
}

const tag = (login) => (x) => ({ ...x, login, uid: `${login}:${x.ticket ?? ""}` });

/**
 * One clock for the whole portfolio when brokers disagree (Exness runs on
 * GMT+0, HFM on GMT+3). GMT+2/+3 servers put midnight at the 17:00 New York
 * close — where the FX trading day actually turns — so one of those wins.
 */
function marketClock(offsets) {
  if (offsets.length <= 1) return offsets[0] ?? null;
  const nyClose = offsets.filter((o) => o === 120 || o === 180);
  return nyClose.length ? Math.max(...nyClose) : null;
}

export function combineReports(reports, currency = "USD") {
  const sum = (f) => r2(reports.reduce((s, r) => s + (Number(f(r.account || {})) || 0), 0));
  const offsets = [...new Set(reports.map((r) => r.account?.serverOffsetMin).filter(Number.isFinite))];
  const times = reports.map((r) => r.updatedAt).filter(Boolean).sort();
  const equity = sum((a) => a.equity);
  const margin = sum((a) => a.margin);

  return {
    combined: true,
    // The total is only as fresh as its stalest account — a reporter that has
    // stopped should turn the badge to "stale", not hide behind the others.
    updatedAt: times[0] || null,
    usdThb: reports.map((r) => r.usdThb).find(Number.isFinite) ?? null,
    account: {
      login: null,
      name: "",
      server: "",
      currency,
      leverage: null,
      balance: sum((a) => a.balance),
      equity,
      credit: sum((a) => a.credit),
      margin,
      freeMargin: sum((a) => a.freeMargin),
      marginLevel: margin > 0 ? r2((equity / margin) * 100) : 0,
      initialDeposit: sum((a) => a.initialDeposit),
      serverOffsetMin: marketClock(offsets),
    },
    positions: reports.flatMap((r) => (r.positions || []).map(tag(r.account?.login))),
    deals: reports
      .flatMap((r) => (r.deals || []).map(tag(r.account?.login)))
      .sort((a, b) => String(a.closeTime || "").localeCompare(String(b.closeTime || ""))),
  };
}

/**
 * Adds up several equity histories ([epochSec, equity, balance] points). Each
 * account holds its last value until its next point, and counts for nothing
 * before its first one — an account opened later shows up as money arriving.
 */
export function sumEquity(seriesList) {
  const series = seriesList.filter((s) => s.points?.length);
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  const at = series.map(() => -1);
  const out = [];
  for (const t of times) {
    let e = 0;
    let b = 0;
    series.forEach((s, i) => {
      while (at[i] + 1 < s.points.length && s.points[at[i] + 1][0] <= t) at[i] += 1;
      if (at[i] >= 0) {
        e += s.points[at[i]][1];
        b += s.points[at[i]][2];
      }
    });
    out.push([t, r2(e), r2(b)]);
  }
  return out;
}
