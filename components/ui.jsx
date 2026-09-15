"use client";

import { Sparkline } from "./charts";

export function Card({ title, subtitle, right, children, className = "", bodyClass = "" }) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-white/[0.08] bg-surface shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      {(title || right) && (
        <header className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={`p-4 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, tone = "neutral", sub, spark, sparkColor }) {
  const toneClass =
    tone === "pos" ? "text-good" : tone === "neg" ? "text-critical" : "text-ink";
  return (
    <div className="rounded-xl border border-white/[0.08] bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold leading-tight ${toneClass}`}>{value}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-[11px] text-muted">{sub}</div>
        {spark && spark.length > 1 && (
          <Sparkline points={spark} color={sparkColor || "#3987e5"} />
        )}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }) {
  const toneClass = tone === "pos" ? "text-good" : tone === "neg" ? "text-critical" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hair/70 py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

export function Pill({ children, color, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-ink2 ${className}`}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function Segmented({ options, value, onChange, size = "md" }) {
  const pad = size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-white/[0.08] bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md ${pad} transition ${
            value === o.value
              ? "bg-white/[0.12] font-medium text-ink"
              : "text-muted hover:bg-white/[0.05] hover:text-ink2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TypeTag({ type }) {
  const buy = type === "BUY";
  return (
    <span
      className={`inline-flex min-w-[42px] justify-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
        buy ? "bg-s1/15 text-s1" : "bg-s2/15 text-s2"
      }`}
    >
      {type}
    </span>
  );
}
