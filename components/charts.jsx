"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* ---------- helpers ---------- */

function useMeasure() {
  const ref = useRef(null);
  const [width, setWidth] = useState(360);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(Math.max(240, Math.round(w)));
    });
    ro.observe(el);
    setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width || 360)));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function Tooltip({ x, y, width, children }) {
  const flip = x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[132px] rounded-lg border border-white/10 bg-[#111110]/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
        top: Math.max(4, y - 12),
      }}
    >
      {children}
    </div>
  );
}

/* ---------- line / area chart ---------- */

export function LineChart({
  series = [],
  height = 260,
  formatY = (v) => v,
  formatX = (v) => v,
  area = true,
  zeroLine = false,
}) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);

  const pad = { l: 58, r: 14, t: 12, b: 26 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = Math.max(10, height - pad.t - pad.b);

  const flat = series.flatMap((s) => s.points);
  const hasData = flat.length > 1;

  const { xMin, xMax, yMin, yMax, ticks } = useMemo(() => {
    if (!flat.length) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, ticks: [] };
    const xs = flat.map((p) => p.x);
    const ys = flat.map((p) => p.y);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (zeroLine) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    const padY = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
    lo -= padY;
    hi += padY;
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: lo,
      yMax: hi,
      ticks: niceTicks(lo, hi, 4),
    };
  }, [flat, zeroLine]);

  const sx = useCallback(
    (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * iw,
    [xMin, xMax, iw, pad.l]
  );
  const sy = useCallback(
    (y) => pad.t + ih - ((y - yMin) / (yMax - yMin || 1)) * ih,
    [yMin, yMax, ih, pad.t]
  );

  const paths = useMemo(
    () =>
      series.map((s) => {
        const d = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
          .join(" ");
        const first = s.points[0];
        const last = s.points[s.points.length - 1];
        const areaD = first
          ? `${d} L${sx(last.x).toFixed(1)},${(pad.t + ih).toFixed(1)} L${sx(first.x).toFixed(
              1
            )},${(pad.t + ih).toFixed(1)} Z`
          : "";
        return { ...s, d, areaD };
      }),
    [series, sx, sy, ih, pad.t]
  );

  const onMove = (e) => {
    if (!hasData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const base = series[0].points;
    const xVal = xMin + ((px - pad.l) / (iw || 1)) * (xMax - xMin);
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < base.length; i++) {
      const d = Math.abs(base[i].x - xVal);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    setHover({ idx, px: sx(base[idx].x) });
  };

  if (!hasData) {
    return (
      <div ref={ref} className="flex min-w-0 items-center justify-center text-sm text-muted" style={{ height }}>
        —
      </div>
    );
  }

  return (
    <div ref={ref} className="relative w-full min-w-0 select-none" style={{ height }}>
      <svg
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="overflow-visible"
      >
        <defs>
          {paths.map((s, i) => (
            <linearGradient key={i} id={`g-${s.key}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={pad.l + iw}
              y1={sy(v)}
              y2={sy(v)}
              stroke={v === 0 ? "#383835" : "#2c2c2a"}
              strokeWidth="1"
            />
            <text x={pad.l - 8} y={sy(v) + 4} textAnchor="end" className="fill-muted text-[10px] tabular-nums">
              {formatY(v)}
            </text>
          </g>
        ))}

        {[0, 0.5, 1].map((f) => {
          const x = xMin + (xMax - xMin) * f;
          return (
            <text
              key={f}
              x={pad.l + iw * f}
              y={height - 6}
              textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
              className="fill-muted text-[10px]"
            >
              {formatX(x)}
            </text>
          );
        })}

        {paths.map((s, i) =>
          area && series.length <= 2 ? (
            <path key={`a-${i}`} d={s.areaD} fill={`url(#g-${s.key}-${i})`} />
          ) : null
        )}
        {paths.map((s, i) => (
          <path
            key={`l-${i}`}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover && (
          <g>
            <line
              x1={hover.px}
              x2={hover.px}
              y1={pad.t}
              y2={pad.t + ih}
              stroke="#898781"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {series.map((s, i) => {
              const p = s.points[Math.min(hover.idx, s.points.length - 1)];
              if (!p) return null;
              return (
                <circle
                  key={i}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r="4.5"
                  fill={s.color}
                  stroke="#1a1a19"
                  strokeWidth="2"
                />
              );
            })}
          </g>
        )}
      </svg>

      {hover && (
        <Tooltip x={hover.px} y={pad.t + 8} width={width}>
          <div className="mb-1 text-[11px] text-muted">
            {formatX(series[0].points[hover.idx].x, true)}
          </div>
          {series.map((s, i) => {
            const p = s.points[Math.min(hover.idx, s.points.length - 1)];
            if (!p) return null;
            return (
              <div key={i} className="flex items-center gap-2 py-[1px]">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-ink2">{s.label}</span>
                <span className="ml-auto tabular-nums text-ink">{formatY(p.y, true)}</span>
              </div>
            );
          })}
        </Tooltip>
      )}
    </div>
  );
}

/* ---------- bar chart ---------- */

export function BarChart({ data = [], height = 220, formatValue = (v) => v, barColor }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);

  const pad = { l: 58, r: 12, t: 12, b: 28 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = Math.max(10, height - pad.t - pad.b);

  const values = data.map((d) => d.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const padY = (hi - lo) * 0.12 || 1;
  const yMin = lo - (lo < 0 ? padY : 0);
  const yMax = hi + padY;
  const ticks = niceTicks(yMin, yMax, 3);
  const sy = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

  const slot = iw / (data.length || 1);
  const bw = Math.max(4, Math.min(46, slot * 0.62));
  const maxLabelLen = data.length
    ? Math.max(...data.map((d) => String(d.short ?? d.label ?? "").length))
    : 0;
  const labelStep = Math.max(1, Math.ceil((maxLabelLen * 6.2 + 10) / (slot || 1)));

  if (!data.length) {
    return <div ref={ref} className="flex min-w-0 items-center justify-center text-sm text-muted" style={{ height }}>—</div>;
  }

  return (
    <div ref={ref} className="relative w-full min-w-0 select-none" style={{ height }}>
      <svg width={width} height={height} className="overflow-visible">
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={pad.l + iw}
              y1={sy(v)}
              y2={sy(v)}
              stroke={v === 0 ? "#383835" : "#2c2c2a"}
            />
            <text x={pad.l - 8} y={sy(v) + 4} textAnchor="end" className="fill-muted text-[10px] tabular-nums">
              {formatValue(v)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = pad.l + slot * (i + 0.5);
          const y0 = sy(0);
          const y1 = sy(d.value);
          const top = Math.min(y0, y1);
          const h = Math.max(2, Math.abs(y1 - y0));
          const color = d.color || barColor || (d.value >= 0 ? "#199e70" : "#d03b3b");
          const r = Math.min(4, h / 2, bw / 2);
          return (
            <g
              key={i}
              onMouseEnter={() => setHover({ i, x: cx, y: top })}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={ih} fill="transparent" />
              <rect
                x={cx - bw / 2}
                y={top}
                width={bw}
                height={h}
                rx={r}
                fill={color}
                opacity={hover && hover.i !== i ? 0.55 : 1}
              />
              {i % labelStep === 0 && (
                <text x={cx} y={height - 8} textAnchor="middle" className="fill-muted text-[10px]">
                  {d.short ?? d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover && (
        <Tooltip x={hover.x} y={hover.y} width={width}>
          <div className="text-[11px] text-muted">{data[hover.i].label}</div>
          <div className="tabular-nums text-ink">{formatValue(data[hover.i].value, true)}</div>
          {data[hover.i].sub && <div className="text-[11px] text-muted">{data[hover.i].sub}</div>}
        </Tooltip>
      )}
    </div>
  );
}

/* ---------- donut ---------- */

export function Donut({ data = [], size = 190, formatValue = (v) => v }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + Math.abs(d.value), 0);
  const R = size / 2;
  const r = R * 0.62;
  if (!total) return <div className="flex h-[190px] items-center justify-center text-sm text-muted">—</div>;

  let angle = -Math.PI / 2;
  const arcs = data.map((d) => {
    const frac = Math.abs(d.value) / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2 - 0.012;
    angle += frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${R + rad * Math.cos(a)},${R + rad * Math.sin(a)}`;
    return {
      ...d,
      frac,
      d: `M${p(R - 2, a0)} A${R - 2},${R - 2} 0 ${large} 1 ${p(R - 2, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`,
    };
  });

  const active = hover !== null ? arcs[hover] : null;

  return (
    <div className="flex items-center justify-center gap-4">
      <svg width={size} height={size}>
        {arcs.map((a, i) => (
          <path
            key={i}
            d={a.d}
            fill={a.color}
            stroke="#1a1a19"
            strokeWidth="2"
            opacity={hover !== null && hover !== i ? 0.45 : 1}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x={R} y={R - 2} textAnchor="middle" className="fill-ink text-[15px] font-semibold tabular-nums">
          {active ? `${(active.frac * 100).toFixed(1)}%` : formatValue(total)}
        </text>
        <text x={R} y={R + 16} textAnchor="middle" className="fill-muted text-[10px]">
          {active ? active.label : "total"}
        </text>
      </svg>
    </div>
  );
}

/* ---------- sparkline ---------- */

export function Sparkline({ points = [], width = 108, height = 30, color = "#3987e5" }) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((p.y - lo) / (hi - lo || 1)) * (height - 4);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function useIsMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
