"use client";

import { BarChart, LineChart } from "./charts";
import { Card, Kpi, Pill, Stat } from "./ui";
import { DealsTable, PositionsTable } from "./tables";
import { duration, money, num, pct, toneOf } from "@/lib/format";
import { formatDate, offsetLabel } from "@/lib/time";

export default function SymbolPanel({ s, T, lang, m, color, digitsFor, tzOffset = 0 }) {
  const curvePoints = s.curve.map((c, i) => ({ x: c.t ? new Date(c.t).getTime() : i, y: c.net }));
  const fmtX = (v, long) => formatDate(v, tzOffset, { year: long });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
        <h2 className="text-lg font-semibold text-ink">{s.symbol}</h2>
        {s.eas.map((e) => (
          <Pill key={e}>{e}</Pill>
        ))}
        {s.magics.map((mg) => (
          <Pill key={mg}>magic {mg}</Pill>
        ))}
        <span className="ml-auto text-xs text-muted">{T.perSymbolNote}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={T.netProfit}
          value={m(s.net, true)}
          tone={s.net > 0 ? "pos" : s.net < 0 ? "neg" : "neutral"}
          sub={`${T.share} ${s.net > 0 ? pct(s.shareOfProfit, 1) : "—"}`}
          spark={curvePoints}
          sparkColor={color}
        />
        <Kpi label={T.winRate} value={pct(s.winRate, 1)} sub={`${s.wins} ${T.wins} / ${s.losses} ${T.losses}`} />
        <Kpi label={T.profitFactor} value={s.profitFactor === null ? "∞" : num(s.profitFactor, 2)} sub={`${T.trades} ${s.trades}`} />
        <Kpi label={T.maxDD} value={m(s.maxDD)} tone={s.maxDD > 0 ? "neg" : "neutral"} sub={pct(s.maxDDPct, 1)} />
        <Kpi label={T.expectancy} value={m(s.expectancy, true)} tone={s.expectancy > 0 ? "pos" : s.expectancy < 0 ? "neg" : "neutral"} sub={`${T.totalLots} ${num(s.volume, 2)}`} />
        <Kpi
          label={T.floating}
          value={m(s.floating, true)}
          tone={s.floating > 0 ? "pos" : s.floating < 0 ? "neg" : "neutral"}
          sub={`${T.openPositions} ${s.positions.length} · ${num(s.openLots, 2)} lot`}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title={`${T.cumulative} — ${s.symbol}`} className="lg:col-span-2">
          <LineChart
            height={300}
            zeroLine
            series={[{ key: `c-${s.symbol}`, label: T.cumulative, color, points: curvePoints }]}
            formatY={(v) => m(v)}
            formatX={fmtX}
          />
        </Card>

        <Card title={T.deepStats}>
          <Stat label={T.grossProfit} value={m(s.grossProfit)} tone="pos" />
          <Stat label={T.grossLoss} value={m(-s.grossLoss)} tone="neg" />
          <Stat label={T.avgWin} value={m(s.avgWin)} tone="pos" />
          <Stat label={T.avgLoss} value={m(-s.avgLoss)} tone="neg" />
          <Stat label={T.rr} value={s.rr === null ? "—" : `1 : ${num(s.rr, 2)}`} />
          <Stat label={T.best} value={m(s.bestTrade, true)} tone="pos" />
          <Stat label={T.worst} value={m(s.worstTrade, true)} tone="neg" />
          <Stat label={T.winStreak} value={`${s.maxWinStreak}`} />
          <Stat label={T.lossStreak} value={`${s.maxLossStreak}`} />
          <Stat label={T.avgHold} value={duration(s.avgHoldMin, lang)} />
          <Stat label={T.commission} value={m(s.commission)} />
          <Stat label={T.swap} value={m(s.swap)} />
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title={`${T.byHour} (${offsetLabel(tzOffset)})`} className="lg:col-span-2">
          <BarChart
            height={220}
            data={s.byHour.map((h) => ({
              label: `${String(h.hour).padStart(2, "0")}:00`,
              short: String(h.hour).padStart(2, "0"),
              value: h.net,
              sub: `${h.trades} ${T.trades}`,
            }))}
            formatValue={(v) => m(v)}
          />
        </Card>

        <Card title={T.buySell}>
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "buy", label: "BUY", color: "#3987e5", d: s.buy },
              { k: "sell", label: "SELL", color: "#d95926", d: s.sell },
            ].map(({ k, label, color: c, d }) => (
              <div key={k} className="rounded-lg border border-white/[0.08] bg-surface2 p-3">
                <div className="flex items-center gap-2 text-xs text-ink2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c }} />
                  {label}
                </div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${toneOf(d.net)}`}>
                  {m(d.net, true)}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {d.trades} {T.trades} · {pct(d.winRate, 1)} win
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Stat label={T.trades} value={`${s.trades}`} />
            <Stat label={T.totalLots} value={num(s.volume, 2)} />
            <Stat label={T.openLots} value={num(s.openLots, 2)} />
          </div>
        </Card>
      </div>

      <Card title={`${T.byDay} — ${s.symbol}`}>
        <BarChart
          height={200}
          data={s.byDay.map((d) => ({
            label: d.date,
            short: d.date.slice(5),
            value: d.net,
          }))}
          formatValue={(v) => m(v)}
        />
      </Card>

      <Card title={`${T.openPositions} — ${s.symbol}`} subtitle={`${s.positions.length}`}>
        <PositionsTable rows={s.positions} T={T} m={m} showSymbol={false} digitsFor={digitsFor} tzOffset={tzOffset} />
      </Card>

      <Card title={`${T.closedDeals} — ${s.symbol}`}>
        <DealsTable
          rows={s.deals}
          T={T}
          m={m}
          lang={lang}
          showSymbol={false}
          digitsFor={digitsFor}
          tzOffset={tzOffset}
        />
      </Card>
    </div>
  );
}
