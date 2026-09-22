"use client";

// Trading calendar — one square per market day.
//
// Deliberately ignores the page's range filter: it has its own month navigation,
// so "today" or "7 days" would otherwise leave it almost empty. It aggregates
// straight from the full deal list, cut on the same market-day boundary as the
// rest of the dashboard. Rows run Sunday→Saturday like an ordinary calendar;
// the trading week itself is Monday→Friday in market time (the market opens
// Sunday 17:00 New York, which is already Monday on the broker's clock), so
// both weekend columns stay empty and a row's total is the trading week's.

import { useMemo, useState } from "react";
import { Card } from "./ui";
import { DealsTable } from "./tables";
import { netOf } from "@/lib/stats";
import { dayKey } from "@/lib/time";
import { toneOf } from "@/lib/format";

const localeOf = (lang) => (lang === "th" ? "th-TH-u-ca-gregory" : "en-GB");

const ymOf = (key) => key.slice(0, 7);

function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Weekday headers, read off a week that starts on a Sunday. */
function weekdayNames(lang) {
  const sunday = Date.UTC(2024, 0, 7); // 7 Jan 2024 was a Sunday
  return Array.from({ length: 7 }, (_, i) =>
    new Date(sunday + i * 864e5).toLocaleDateString(localeOf(lang), {
      weekday: "short",
      timeZone: "UTC",
    })
  );
}

export default function TradingCalendar({
  deals,
  T,
  lang,
  m,
  tzOffset,
  digitsFor,
  selected,
  onSelect,
}) {
  // day key -> { net, trades, wins, losses }
  const byDay = useMemo(() => {
    const map = new Map();
    for (const d of deals) {
      if (!d.closeTime) continue;
      const key = dayKey(d.closeTime, tzOffset);
      if (!key) continue;
      const e = map.get(key) || { net: 0, trades: 0, wins: 0, losses: 0 };
      const n = netOf(d);
      e.net += n;
      e.trades += 1;
      if (n > 0) e.wins += 1;
      else if (n < 0) e.losses += 1;
      map.set(key, e);
    }
    return map;
  }, [deals, tzOffset]);

  const keys = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  const todayKey = dayKey(new Date(), tzOffset);
  // Opening on an empty month looks like a bug, so fall back to the last month traded.
  const [month, setMonth] = useState(() => {
    const thisMonth = ymOf(todayKey);
    if (!keys.length || keys.some((k) => ymOf(k) === thisMonth)) return thisMonth;
    return ymOf(keys[keys.length - 1]);
  });

  const firstMonth = keys.length ? ymOf(keys[0]) : ymOf(todayKey);
  const lastMonth = ymOf(todayKey); // no point navigating into the future

  const { weeks, stats } = useMemo(() => {
    const [y, mo] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const lead = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); // Sunday = 0

    const cells = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${month}-${String(day).padStart(2, "0")}`;
      cells.push({ day, key, net: 0, trades: 0, wins: 0, losses: 0, ...byDay.get(key) });
    }
    while (cells.length % 7) cells.push(null);

    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

    const traded = cells.filter((c) => c && c.trades);
    const nets = traded.map((c) => c.net);
    return {
      weeks: rows,
      stats: {
        net: nets.reduce((a, b) => a + b, 0),
        days: traded.length,
        best: traded.length ? traded.reduce((a, b) => (b.net > a.net ? b : a)) : null,
        worst: traded.length ? traded.reduce((a, b) => (b.net < a.net ? b : a)) : null,
        peak: Math.max(0, ...nets.map(Math.abs)),
      },
    };
  }, [month, byDay]);

  // Shade by how big the day was, not just by its sign — a +$0.50 day should not
  // look the same as a +$50 one.
  const tint = (net) => {
    if (!net || !stats.peak) return undefined;
    const alpha = 0.1 + 0.32 * (Math.abs(net) / stats.peak);
    return net > 0 ? `rgba(12,163,12,${alpha})` : `rgba(208,59,59,${alpha})`;
  };

  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(localeOf(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const dayLabel = (key) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString(localeOf(lang), {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  const step = (delta) => {
    const next = addMonths(month, delta);
    setMonth(next);
    if (selected && ymOf(selected) !== next) onSelect(null);
  };

  const navBtn =
    "rounded-lg border border-white/[0.08] bg-surface2 px-2.5 py-1 text-sm text-ink2 transition enabled:hover:bg-white/[0.08] enabled:hover:text-ink disabled:opacity-30";

  const selectedDay = selected ? byDay.get(selected) : null;
  const selectedDeals = selected
    ? deals.filter((d) => d.closeTime && dayKey(d.closeTime, tzOffset) === selected)
    : [];

  return (
    <Card
      title={T.tradingCalendar}
      subtitle={T.calendarNote}
      right={
        <div className="flex items-center gap-2">
          <button
            onClick={() => step(-1)}
            disabled={month <= firstMonth}
            className={navBtn}
            aria-label="previous month"
          >
            ‹
          </button>
          <span className="min-w-[130px] text-center text-sm font-medium text-ink">
            {monthLabel}
          </span>
          <button
            onClick={() => step(1)}
            disabled={month >= lastMonth}
            className={navBtn}
            aria-label="next month"
          >
            ›
          </button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>
          {T.monthTotal}{" "}
          <span className={`font-medium tabular-nums ${toneOf(stats.net)}`}>
            {m(stats.net, true)}
          </span>
        </span>
        <span>
          {T.tradingDays} <span className="tabular-nums text-ink2">{stats.days}</span>
        </span>
        {stats.best && stats.best.net > 0 && (
          <span>
            {T.bestDay}{" "}
            <span className="tabular-nums text-good">
              {stats.best.day} · {m(stats.best.net, true)}
            </span>
          </span>
        )}
        {stats.worst && stats.worst.net < 0 && (
          <span>
            {T.worstDay}{" "}
            <span className="tabular-nums text-critical">
              {stats.worst.day} · {m(stats.worst.net, true)}
            </span>
          </span>
        )}
      </div>

      {/* a day cell can't shrink below its own P/L figure, so the grid keeps a
          minimum width and scrolls sideways on a phone — same as the tables */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="grid min-w-[660px] grid-cols-8 gap-1">
          {weekdayNames(lang).map((d) => (
            <div key={d} className="truncate pb-1 text-center text-[11px] uppercase tracking-wide text-muted">
              {d}
            </div>
          ))}
          <div className="truncate pb-1 text-center text-[11px] uppercase tracking-wide text-muted">
            {T.week}
          </div>

          {weeks.map((week, wi) => {
            const weekNet = week.reduce((s, c) => s + (c?.net || 0), 0);
            const weekTrades = week.reduce((s, c) => s + (c?.trades || 0), 0);
            return (
              <Row key={wi}>
                {week.map((cell, ci) =>
                  !cell ? (
                    <div key={ci} className="min-h-[84px] rounded-lg" />
                  ) : (
                    <button
                      key={cell.key}
                      onClick={() =>
                        cell.trades && onSelect(selected === cell.key ? null : cell.key)
                      }
                      disabled={!cell.trades}
                      style={{ background: tint(cell.net) }}
                      className={`min-h-[84px] rounded-lg border p-2 text-left transition ${
                        selected === cell.key
                          ? "border-s1 ring-1 ring-s1"
                          : cell.key === todayKey
                          ? "border-line"
                          : "border-white/[0.06]"
                      } ${
                        cell.trades
                          ? "cursor-pointer hover:border-white/25"
                          : "cursor-default bg-surface2/40"
                      }`}
                    >
                      <div
                        className={`text-[11px] tabular-nums ${
                          cell.key === todayKey ? "font-semibold text-ink" : "text-muted"
                        }`}
                      >
                        {cell.day}
                      </div>
                      {cell.trades > 0 && (
                        <>
                          <div
                            className={`mt-1 whitespace-nowrap text-[12px] font-semibold leading-tight tabular-nums ${toneOf(
                              cell.net
                            )}`}
                          >
                            {m(cell.net, true)}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-tight text-ink2">
                            {cell.trades} {T.tradesShort}
                          </div>
                          <div className="text-[10px] leading-tight text-muted">
                            {cell.wins}W · {cell.losses}L
                          </div>
                        </>
                      )}
                    </button>
                  )
                )}
                <div className="flex min-h-[84px] flex-col justify-center rounded-lg border border-white/[0.06] bg-surface2/60 p-2">
                  <div className={`whitespace-nowrap text-[12px] font-semibold tabular-nums ${toneOf(weekNet)}`}>
                    {weekTrades ? m(weekNet, true) : "—"}
                  </div>
                  {weekTrades > 0 && (
                    <div className="mt-0.5 text-[10px] text-muted">
                      {weekTrades} {T.tradesShort}
                    </div>
                  )}
                </div>
              </Row>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="mt-4 border-t border-hair pt-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{dayLabel(selected)}</span>
            {selectedDay && (
              <>
                <span className={`text-sm font-semibold tabular-nums ${toneOf(selectedDay.net)}`}>
                  {m(selectedDay.net, true)}
                </span>
                <span className="text-[11px] text-muted">
                  {selectedDay.trades} {T.tradesShort} · {selectedDay.wins}W ·{" "}
                  {selectedDay.losses}L
                </span>
              </>
            )}
            <button
              onClick={() => onSelect(null)}
              className="ml-auto rounded-lg border border-white/[0.08] bg-surface2 px-2 py-1 text-[11px] text-muted transition hover:text-ink"
            >
              {T.clearDay}
            </button>
          </div>
          <DealsTable
            rows={selectedDeals}
            T={T}
            m={m}
            lang={lang}
            digitsFor={digitsFor}
            tzOffset={tzOffset}
            pageSize={10}
          />
        </div>
      )}
    </Card>
  );
}

/** A week's cells flow straight into the parent grid, so a row adds no markup. */
const Row = ({ children }) => <>{children}</>;
