"use client";

// The accounts behind the combined view: tick which ones count towards the
// total, click a row to open that account on its own.

import { Card } from "./ui";
import { num, pct, relative, toneOf } from "@/lib/format";

const th = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted";
const td = "px-3 py-2 text-sm tabular-nums whitespace-nowrap";

export default function AccountsCard({ rows, T, m, lang, onToggle, onOpen }) {
  const includedCount = rows.filter((r) => r.included).length;

  return (
    <Card title={T.accountsCard} subtitle={T.accountsCardNote}>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-hair">
              {[T.inTotal, T.account, T.balance, T.equity, T.floating, T.netProfit, T.trades, T.winRate, T.profitFactor, T.maxDD, T.lastReport].map(
                (h, i) => (
                  <th key={h + i} className={`${th} ${i < 2 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = r.model.portfolio;
              const a = r.model.account;
              // An account in another currency is shown in its own money, unconverted.
              const money = (v, sign) =>
                r.compatible ? m(v, sign) : `${sign && v > 0 ? "+" : ""}${num(v, 2)} ${r.currency}`;
              // Never let the last ticked account go — an empty total has nothing to show.
              const locked = !r.compatible || (r.included && includedCount === 1);
              return (
                <tr
                  key={r.login}
                  onClick={() => onOpen(r.login)}
                  className={`cursor-pointer border-b border-hair/60 last:border-0 hover:bg-white/[0.04] ${
                    r.included ? "" : "opacity-50"
                  }`}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={r.included}
                      disabled={locked}
                      onChange={() => onToggle(r.login)}
                      className="h-4 w-4 cursor-pointer accent-s1 disabled:cursor-not-allowed"
                      aria-label={`${T.inTotal} #${r.login}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${r.stale ? "bg-serious" : "bg-good"}`}
                        title={r.stale ? T.stale : T.live}
                      />
                      <span className="font-medium text-ink">#{r.login}</span>
                      {r.name && <span className="text-muted">{r.name}</span>}
                    </div>
                    <div className="ml-4 text-[11px] text-muted">
                      {r.server}
                      {!r.compatible && <span className="text-warn"> · {T.otherCurrency(r.currency)}</span>}
                    </div>
                  </td>
                  <td className={`${td} text-right text-ink2`}>{money(a.balance)}</td>
                  <td className={`${td} text-right text-ink`}>{money(a.equity)}</td>
                  <td className={`${td} text-right ${toneOf(p.floating)}`}>
                    {p.openCount ? money(p.floating, true) : "—"}
                  </td>
                  <td className={`${td} text-right font-medium ${toneOf(p.net)}`}>{money(p.net, true)}</td>
                  <td className={`${td} text-right text-ink2`}>{p.trades}</td>
                  <td className={`${td} text-right text-ink2`}>{p.trades ? pct(p.winRate, 1) : "—"}</td>
                  <td className={`${td} text-right text-ink2`}>
                    {!p.trades ? "—" : p.profitFactor === null ? "∞" : num(p.profitFactor, 2)}
                  </td>
                  <td className={`${td} text-right text-ink2`}>
                    {p.trades ? `${money(p.maxDD)} (${pct(p.maxDDPct, 1)})` : "—"}
                  </td>
                  <td className={`${td} text-right text-muted`}>{relative(r.updatedAt, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
