export const SERIES = [
  "#3987e5", "#d95926", "#199e70", "#c98500",
  "#d55181", "#008300", "#9085e9", "#e66767",
];

export const colorFor = (i) => SERIES[i % SERIES.length];

export function money(v, { currency = "USD", rate = 1, digits = 2, sign = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const val = v * rate;
  const s = Math.abs(val).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = currency === "THB" ? "฿" : "$";
  const neg = val < 0;
  const prefix = neg ? "−" : sign ? "+" : "";
  return `${prefix}${symbol}${s}`;
}

export function num(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(v, digits = 2, sign = false) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = `${Math.abs(v).toFixed(digits)}%`;
  return v < 0 ? `−${s}` : sign ? `+${s}` : s;
}

export function duration(mins, lang = "th") {
  if (mins === null || mins === undefined) return "—";
  if (mins < 60) return `${Math.round(mins)} ${lang === "th" ? "นาที" : "min"}`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}${lang === "th" ? " ชม." : "h"} ${m}${lang === "th" ? " น." : "m"}`;
}

export function dateTime(iso, { withSeconds = false } = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export function shortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function relative(iso, lang = "th") {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return lang === "th" ? "เมื่อครู่" : "just now";
  if (diff < 3600)
    return lang === "th" ? `${Math.floor(diff / 60)} นาทีที่แล้ว` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)
    return lang === "th" ? `${Math.floor(diff / 3600)} ชม.ที่แล้ว` : `${Math.floor(diff / 3600)}h ago`;
  return lang === "th" ? `${Math.floor(diff / 86400)} วันที่แล้ว` : `${Math.floor(diff / 86400)}d ago`;
}

export const toneOf = (v) => (v > 0 ? "text-good" : v < 0 ? "text-critical" : "text-ink2");
