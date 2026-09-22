// Market time — the clock the trading day is measured on.
//
// Everything that reaches the dashboard is stored as real UTC. A trading day,
// though, does not start at the viewer's midnight: MT5 brokers set their server
// clock so that server midnight is the 17:00 New York rollover, i.e. exactly
// where one trading day ends and the next begins (which is why a "GMT+3" broker
// in summer becomes GMT+2 in winter — the rollover stays put).
//
// So every day/month boundary, every hour/weekday bucket and every timestamp on
// screen goes through a fixed offset from UTC instead of through the browser's
// own time zone. `offsetMin` below is always "minutes east of UTC".

/** Used when the bridge has not told us the broker's offset yet. */
export const DEFAULT_OFFSET_MIN = 180; // GMT+3

/** Thailand is GMT+7 all year — no DST to track. */
export const THAI_OFFSET_MIN = 420;

/**
 * What the picker offers: the broker's own clock ("auto", i.e. market time) or
 * the clock the user lives in.
 */
export const TZ_SETTINGS = ["auto", String(THAI_OFFSET_MIN)];

export function offsetLabel(min) {
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `GMT${min < 0 ? "−" : "+"}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/**
 * Turn the stored setting into a concrete offset.
 * `serverOffsetMin` is what the account reported (null when unknown).
 */
export function resolveOffset(setting, serverOffsetMin = null) {
  if (!setting || setting === "auto") {
    return Number.isFinite(serverOffsetMin) ? serverOffsetMin : DEFAULT_OFFSET_MIN;
  }
  const n = Number(setting);
  return Number.isFinite(n) ? n : DEFAULT_OFFSET_MIN;
}

/**
 * A Date whose *UTC* getters read as the market-time wall clock.
 * Only ever used through the helpers below — never mix it with local getters.
 */
export function shift(t, offsetMin) {
  const ms = t instanceof Date ? t.getTime() : new Date(t).getTime();
  return new Date(ms + offsetMin * 60000);
}

/** "YYYY-MM-DD" of an instant, in market time. */
export function dayKey(t, offsetMin) {
  const d = shift(t, offsetMin);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Real-UTC instant at which the market day containing `now` started. */
export function startOfDay(now, offsetMin) {
  const d = shift(now, offsetMin);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - offsetMin * 60000);
}

/** Real-UTC instant at which the market week containing `now` started (Monday). */
export function startOfWeek(now, offsetMin) {
  const d = shift(now, offsetMin);
  const sinceMonday = (d.getUTCDay() + 6) % 7; // Sunday counts as the 7th day, not the 1st
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return new Date(d.getTime() - offsetMin * 60000);
}

/** Real-UTC instant at which the market month containing `now` started. */
export function startOfMonth(now, offsetMin) {
  const d = shift(now, offsetMin);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return new Date(first - offsetMin * 60000);
}

const fmt = (t, offsetMin, opts) => {
  const d = shift(t, offsetMin);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { timeZone: "UTC", ...opts });
};

export function formatDateTime(t, offsetMin, { withSeconds = false } = {}) {
  if (!t) return "—";
  return fmt(t, offsetMin, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export function formatDate(t, offsetMin, { year = false } = {}) {
  if (!t) return "—";
  return fmt(t, offsetMin, {
    day: "2-digit",
    month: "short",
    ...(year ? { year: "2-digit" } : {}),
  });
}

/** "2026-09-15 10:22:31" in market time — for CSV exports. */
export function stamp(t, offsetMin) {
  if (!t) return "";
  const d = shift(t, offsetMin);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 19).replace("T", " ");
}
