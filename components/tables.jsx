"use client";

import { useMemo, useState } from "react";
import { TypeTag } from "./ui";
import { duration, num, toneOf } from "@/lib/format";
import { formatDateTime, stamp } from "@/lib/time";

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted";
const td = "px-3 py-2 text-sm text-ink2 whitespace-nowrap";

function toCsv(rows, columns) {
  const head = columns.map((c) => c.key).join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const v = c.raw ? c.raw(r) : r[c.key];
          const s = v === null || v === undefined ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
  return `${head}\n${body}`;
}

function DownloadCsv({ rows, columns, name, label }) {
  const onClick = () => {
    const blob = new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted transition hover:bg-white/[0.06] hover:text-ink"
    >
      {label}
    </button>
  );
}

export function PositionsTable({ rows, T, m, showSymbol = true, digitsFor = () => 2, tzOffset = 0 }) {
  if (!rows.length) {
    return <div className="py-6 text-center text-sm text-muted">{T.noOpen}</div>;
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-hair">
            {showSymbol && <th className={th}>{T.symbol}</th>}
            <th className={th}>{T.type}</th>
            <th className={`${th} text-right`}>{T.volume}</th>
            <th className={`${th} text-right`}>{T.openPrice}</th>
            <th className={`${th} text-right`}>{T.current}</th>
            <th className={`${th} text-right`}>{T.sl}</th>
            <th className={`${th} text-right`}>{T.tp}</th>
            <th className={`${th} text-right`}>{T.profit}</th>
            <th className={th}>{T.openTime}</th>
            <th className={th}>{T.ea}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const net = p.profit + p.swap + p.commission;
            const dg = digitsFor(p.symbol);
            return (
              <tr key={p.ticket} className="border-b border-hair/60 last:border-0 hover:bg-white/[0.03]">
                {showSymbol && <td className={`${td} font-medium text-ink`}>{p.symbol}</td>}
                <td className={td}><TypeTag type={p.type} /></td>
                <td className={`${td} text-right tabular-nums`}>{num(p.volume, 2)}</td>
                <td className={`${td} text-right tabular-nums`}>{num(p.openPrice, dg)}</td>
                <td className={`${td} text-right tabular-nums`}>{num(p.currentPrice, dg)}</td>
                <td className={`${td} text-right tabular-nums text-muted`}>{p.sl ? num(p.sl, dg) : "—"}</td>
                <td className={`${td} text-right tabular-nums text-muted`}>{p.tp ? num(p.tp, dg) : "—"}</td>
                <td className={`${td} text-right font-medium tabular-nums ${toneOf(net)}`}>{m(net, true)}</td>
                <td className={`${td} text-muted`}>{formatDateTime(p.openTime, tzOffset)}</td>
                <td className={`${td} text-muted`}>{p.comment || p.magic || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DealsTable({
  rows,
  T,
  m,
  lang,
  showSymbol = true,
  digitsFor = () => 2,
  pageSize = 20,
  tzOffset = 0,
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => String(b.closeTime).localeCompare(String(a.closeTime))),
    [rows]
  );
  const shown = expanded ? sorted : sorted.slice(0, pageSize);

  if (!rows.length) {
    return <div className="py-6 text-center text-sm text-muted">{T.noDeals}</div>;
  }

  // Exported on the same clock the table shows, not raw UTC.
  const csvColumns = [
    { key: "closeTime", raw: (r) => stamp(r.closeTime, tzOffset) },
    { key: "openTime", raw: (r) => stamp(r.openTime, tzOffset) },
    { key: "symbol" },
    { key: "type" },
    { key: "volume" },
    { key: "openPrice" },
    { key: "closePrice" },
    { key: "profit" },
    { key: "swap" },
    { key: "commission" },
    { key: "net", raw: (r) => (r.profit + r.swap + r.commission).toFixed(2) },
    { key: "magic" },
    { key: "comment" },
  ];

  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[780px] border-collapse">
          <thead>
            <tr className="border-b border-hair">
              <th className={th}>{T.closeTime}</th>
              {showSymbol && <th className={th}>{T.symbol}</th>}
              <th className={th}>{T.type}</th>
              <th className={`${th} text-right`}>{T.volume}</th>
              <th className={`${th} text-right`}>{T.openPrice}</th>
              <th className={`${th} text-right`}>{T.closePrice}</th>
              <th className={`${th} text-right`}>{T.duration}</th>
              <th className={`${th} text-right`}>{T.swap}</th>
              <th className={`${th} text-right`}>{T.commission}</th>
              <th className={`${th} text-right`}>{T.net}</th>
              <th className={th}>{T.ea}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d, i) => {
              const net = d.profit + d.swap + d.commission;
              const dg = digitsFor(d.symbol);
              const held =
                d.openTime && d.closeTime
                  ? (new Date(d.closeTime) - new Date(d.openTime)) / 60000
                  : null;
              return (
                <tr
                  key={d.ticket ?? i}
                  className="border-b border-hair/60 last:border-0 hover:bg-white/[0.03]"
                >
                  <td className={`${td} text-muted`}>{formatDateTime(d.closeTime, tzOffset)}</td>
                  {showSymbol && <td className={`${td} font-medium text-ink`}>{d.symbol}</td>}
                  <td className={td}><TypeTag type={d.type} /></td>
                  <td className={`${td} text-right tabular-nums`}>{num(d.volume, 2)}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(d.openPrice, dg)}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(d.closePrice, dg)}</td>
                  <td className={`${td} text-right tabular-nums text-muted`}>{duration(held, lang)}</td>
                  <td className={`${td} text-right tabular-nums text-muted`}>{num(d.swap, 2)}</td>
                  <td className={`${td} text-right tabular-nums text-muted`}>{num(d.commission, 2)}</td>
                  <td className={`${td} text-right font-medium tabular-nums ${toneOf(net)}`}>
                    {m(net, true)}
                  </td>
                  <td className={`${td} text-muted`}>{d.comment || d.magic || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-[11px] text-muted">{T.rowsOf(shown.length, sorted.length)}</span>
        {sorted.length > pageSize && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted transition hover:bg-white/[0.06] hover:text-ink"
          >
            {expanded ? T.showLess : T.showAll}
          </button>
        )}
        <div className="ml-auto">
          <DownloadCsv rows={sorted} columns={csvColumns} name="mt5-deals.csv" label={T.exportCsv} />
        </div>
      </div>
    </div>
  );
}
