"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildModel, customDays, customRange, filterDealsByRange, isCustom } from "@/lib/stats";
import { t } from "@/lib/i18n";
import { colorFor, duration, money, num, pct, relative, toneOf } from "@/lib/format";
import {
  dayKey,
  formatDate,
  formatDateTime,
  offsetLabel,
  resolveOffset,
  THAI_OFFSET_MIN,
  TZ_SETTINGS,
} from "@/lib/time";
import { BarChart, Donut, LineChart } from "@/components/charts";
import { Card, Kpi, Pill, Segmented, Stat } from "@/components/ui";
import { DealsTable, PositionsTable } from "@/components/tables";
import TradingCalendar from "@/components/calendar";
import SymbolPanel from "@/components/symbol-panel";

const RANGES = ["all", "today", "wtd", "7d", "30d", "90d", "mtd", "custom"];
const INTERVALS = [0, 30, 60, 300];

const load = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export default function Page() {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState("th");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState(36.5);          // เรตที่กรอกเอง
  const [rateMode, setRateMode] = useState("auto");
  const [autoFx, setAutoFx] = useState(null);      // { rate, source, at } จาก /api/fx
  const [range, setRange] = useState("all");
  const [tab, setTab] = useState("__all__");
  const [account, setAccount] = useState(null);
  const [interval_, setInterval_] = useState(60);
  // Which clock the trading day is counted on — "auto" follows the broker.
  const [tz, setTz] = useState("auto");
  // Day picked in the calendar ("YYYY-MM-DD" on the market clock), or null.
  const [calDay, setCalDay] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    setLang(load("mt5.lang", "th"));
    setCurrency(load("mt5.currency", "USD"));
    setRate(load("mt5.rate", 36.5));
    setRateMode(load("mt5.rateMode", "auto"));
    setRange(load("mt5.range", "all"));
    setInterval_(load("mt5.interval", 60));
    setAccount(load("mt5.account", null));
    // "auto" = the broker's clock; anything else stored by an older build is stale
    const savedTz = load("mt5.tz", "auto");
    setTz(TZ_SETTINGS.includes(savedTz) ? savedTz : "auto");
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const qs = account ? `?account=${encodeURIComponent(account)}` : "";
      const res = await fetch(`/api/report${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRaw(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (interval_ > 0) timer.current = setInterval(fetchData, interval_ * 1000);
    return () => timer.current && clearInterval(timer.current);
  }, [interval_, fetchData]);

  const accounts = raw?.accounts || [];

  // Pick the newest account on first load, and recover if the selected one
  // disappears (that bridge stopped reporting, or KV was cleared).
  useEffect(() => {
    if (!accounts.length) return;
    if (!accounts.some((a) => String(a.login) === String(account))) {
      setAccount(String(accounts[0].login));
    }
  }, [accounts, account]);

  const T = t(lang);
  const serverOffset = raw?.account?.serverOffsetMin;
  const tzOffset = resolveOffset(tz, Number.isFinite(serverOffset) ? serverOffset : null);
  const tzName = offsetLabel(tzOffset);
  const picked = customDays(range);
  // ปฏิทินของ input ไม่ควรให้เลือกเลยวันที่มีข้อมูล
  const dayRange = useMemo(() => {
    const days = (raw?.deals || [])
      .map((d) => d.closeTime && dayKey(d.closeTime, tzOffset))
      .filter(Boolean)
      .sort();
    return { first: days[0] || null, last: dayKey(new Date(), tzOffset) };
  }, [raw, tzOffset]);
  // เรตบาท: ฟีดโบรก > แหล่งออนไลน์ > ที่กรอกเอง
  const brokerFx = Number.isFinite(raw?.usdThb) ? raw.usdThb : null;
  const lookedUpFx = brokerFx ?? (Number.isFinite(autoFx?.rate) ? autoFx.rate : null);
  const fxRate = rateMode === "auto" && lookedUpFx ? lookedUpFx : rate;
  const fxSource =
    rateMode === "manual" || !lookedUpFx
      ? T.fxTyped
      : brokerFx
      ? `${T.fxFromBroker} · ${formatDateTime(raw?.updatedAt, tzOffset)}`
      : `${autoFx.source}${autoFx.at ? ` · ${autoFx.at}` : ""}`;
  const fx = currency === "THB" ? fxRate : 1;
  const m = useCallback(
    (v, sign = false) => money(v, { currency, rate: fx, sign }),
    [currency, fx]
  );

  // ไม่ต้องไปถามเรตถ้าฝั่ง MT5 ส่งมาแล้ว หรือผู้ใช้กรอกเอง
  useEffect(() => {
    if (currency !== "THB" || rateMode !== "auto" || brokerFx) return;
    let alive = true;
    fetch("/api/fx")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && Number.isFinite(j?.rate)) setAutoFx(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [currency, rateMode, brokerFx]);

  // A day key belongs to the clock it was cut on, so drop it when that changes.
  useEffect(() => {
    setCalDay(null);
  }, [tzOffset, account]);

  const model = useMemo(
    () => (raw ? buildModel(raw, { range, offsetMin: tzOffset }) : null),
    [raw, range, tzOffset]
  );

  const digitsFor = useCallback(
    (symbol) => {
      if (!model) return 2;
      const sample =
        model.deals.find((d) => d.symbol === symbol)?.openPrice ??
        model.positions.find((p) => p.symbol === symbol)?.openPrice ??
        1;
      const a = Math.abs(sample);
      if (a >= 1000) return 2;
      if (a >= 100) return 3;
      if (a >= 10) return 3;
      return 5;
    },
    [model]
  );

  const equitySeries = useMemo(() => {
    if (!model) return [];
    const hist = filterDealsByRange(
      (model.equityHistory || []).map((p) => ({ ...p, closeTime: p.t })),
      range,
      new Date(),
      tzOffset
    );
    if (hist.length > 1) {
      return [
        {
          key: "equity",
          label: T.equity,
          color: "#3987e5",
          points: hist.map((p) => ({ x: new Date(p.t).getTime(), y: p.equity })),
        },
        {
          key: "balance",
          label: T.balance,
          color: "#199e70",
          points: hist.map((p) => ({ x: new Date(p.t).getTime(), y: p.balance })),
        },
      ];
    }
    const c = model.portfolio.curve;
    if (c.length > 1) {
      return [
        {
          key: "balance",
          label: T.balance,
          color: "#3987e5",
          points: c.map((p, i) => ({ x: p.t ? new Date(p.t).getTime() : i, y: p.value })),
        },
      ];
    }
    return [];
  }, [model, range, T, tzOffset]);

  const fmtX = (v, long) =>
    long ? formatDateTime(v, tzOffset) : formatDate(v, tzOffset);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted">
        loading…
      </main>
    );
  }

  const empty = !model || raw?.empty || (!model.deals.length && !model.positions.length);
  const isDemo = raw?.source === "demo";
  const acc = model?.account || {};
  const p = model?.portfolio;
  const stale = model?.updatedAt
    ? Date.now() - new Date(model.updatedAt).getTime() > 15 * 60 * 1000
    : true;

  const symbolColor = (name) =>
    colorFor((model?.symbolNames || []).indexOf(name));

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      {/* ---------- header ---------- */}
      <header className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{T.appTitle}</h1>
            {isDemo ? (
              <Pill color="#fab219">{T.demo}</Pill>
            ) : stale ? (
              <Pill color="#ec835a">{T.stale}</Pill>
            ) : (
              <Pill color="#0ca30c">{T.live}</Pill>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {T.subtitle}
            {acc.login && (
              <>
                {" · "}
                {T.account} <span className="text-ink2">#{acc.login}</span>
                {acc.server && <> · {acc.server}</>}
                {acc.leverage ? <> · 1:{acc.leverage}</> : null}
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {T.updated} {formatDateTime(model?.updatedAt, tzOffset, { withSeconds: true })} {tzName}{" "}
            ({relative(model?.updatedAt, lang)})
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {accounts.length > 1 && (
            <select
              value={account ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setAccount(v);
                save("mt5.account", v);
              }}
              className="max-w-[240px] rounded-lg border border-white/[0.08] bg-surface2 px-2 py-1.5 text-xs text-ink2 outline-none"
            >
              {accounts.map((a) => (
                <option key={a.login} value={a.login}>
                  {`#${a.login}${a.name ? ` · ${a.name}` : ""}${a.server ? ` · ${a.server}` : ""}`}
                </option>
              ))}
            </select>
          )}
          <Segmented
            size="sm"
            options={[{ value: "th", label: "TH" }, { value: "en", label: "EN" }]}
            value={lang}
            onChange={(v) => { setLang(v); save("mt5.lang", v); }}
          />
          <Segmented
            size="sm"
            options={[{ value: "USD", label: "USD" }, { value: "THB", label: "THB" }]}
            value={currency}
            onChange={(v) => { setCurrency(v); save("mt5.currency", v); }}
          />
          {currency === "THB" && (
            <div
              title={`${T.fxRate} USD→THB · ${fxSource}`}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-surface2 px-2 py-1 text-[11px] text-muted"
            >
              {T.fxRate}
              {rateMode === "auto" && lookedUpFx ? (
                <span className="tabular-nums text-ink">{num(fxRate, 3)}</span>
              ) : (
                <input
                  type="number"
                  step="0.1"
                  value={rate}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    setRate(v);
                    save("mt5.rate", v);
                  }}
                  className="w-16 bg-transparent text-right text-ink outline-none"
                />
              )}
              <button
                onClick={() => {
                  const next = rateMode === "auto" ? "manual" : "auto";
                  // ออกจากโหมดอัตโนมัติ ให้เริ่มจากเรตที่เห็นอยู่ ไม่ใช่ค่าเก่าค้างในเครื่อง
                  if (next === "manual" && lookedUpFx) {
                    setRate(fxRate);
                    save("mt5.rate", fxRate);
                  }
                  setRateMode(next);
                  save("mt5.rateMode", next);
                }}
                className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-muted transition hover:bg-white/[0.08] hover:text-ink"
              >
                {rateMode === "auto" ? T.fxManual : T.fxAuto}
              </button>
            </div>
          )}
          <Segmented
            size="sm"
            options={[
              { value: "auto", label: T.tzMarket },
              { value: String(THAI_OFFSET_MIN), label: T.tzThai },
            ]}
            value={tz}
            onChange={(v) => { setTz(v); save("mt5.tz", v); }}
          />
          <select
            value={interval_}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setInterval_(v);
              save("mt5.interval", v);
            }}
            className="rounded-lg border border-white/[0.08] bg-surface2 px-2 py-1.5 text-xs text-ink2 outline-none"
          >
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? `${T.autoRefresh}: ${T.off}` : `${T.autoRefresh}: ${s}s`}
              </option>
            ))}
          </select>
          <button
            onClick={fetchData}
            className="rounded-lg border border-white/[0.08] bg-surface2 px-3 py-1.5 text-xs text-ink2 transition hover:bg-white/[0.08] hover:text-ink"
          >
            ↻ {T.refresh}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-critical/30 bg-critical/10 px-4 py-2 text-sm text-critical">
          {error}
        </div>
      )}

      {empty ? (
        <Card title={T.noData}>
          <p className="text-sm text-ink2">{T.noDataHint}</p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-hair bg-page p-3 text-xs text-muted">
{`curl -X POST https://<your-app>.vercel.app/api/report \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: <INGEST_TOKEN>" \\
  -d @snapshot.json`}
          </pre>
        </Card>
      ) : (
        <>
          {/* ---------- controls ---------- */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">{T.range}</span>
            <Segmented
              size="sm"
              options={RANGES.map((r) => ({ value: r, label: T.ranges[r] }))}
              value={isCustom(range) ? "custom" : range}
              onChange={(v) => {
                // เริ่มช่วงกำหนดเองที่ 30 วันล่าสุด ให้มีอะไรให้ดูทันที
                const next =
                  v !== "custom"
                    ? v
                    : customRange(
                        dayKey(new Date(Date.now() - 30 * 864e5), tzOffset),
                        dayKey(new Date(), tzOffset)
                      );
                setRange(next);
                save("mt5.range", next);
              }}
            />
            {isCustom(range) && (
              <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-surface2 px-2 py-1 text-[11px] text-muted">
                {["from", "to"].map((side) => (
                  <Fragment key={side}>
                    {side === "to" && <span>–</span>}
                    <input
                      type="date"
                      value={side === "from" ? picked.from : picked.to}
                      min={side === "to" ? picked.from || dayRange.first : dayRange.first}
                      max={side === "from" ? picked.to || dayRange.last : dayRange.last}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        const next =
                          side === "from"
                            ? customRange(v, picked.to < v ? v : picked.to)
                            : customRange(picked.from > v ? v : picked.from, v);
                        setRange(next);
                        save("mt5.range", next);
                      }}
                      className="bg-transparent text-ink outline-none [color-scheme:dark]"
                      aria-label={side === "from" ? T.dateFrom : T.dateTo}
                    />
                  </Fragment>
                ))}
              </div>
            )}
            <span className="text-[11px] text-muted">
              {T.tzNote} ({tzName})
            </span>
          </div>

          {/* ---------- pair tabs ---------- */}
          <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-surface p-1">
            <button
              onClick={() => setTab("__all__")}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                tab === "__all__"
                  ? "bg-white/[0.12] font-medium text-ink"
                  : "text-muted hover:bg-white/[0.05] hover:text-ink2"
              }`}
            >
              {T.tabOverview}
            </button>
            {model.bySymbol.map((s) => (
              <button
                key={s.symbol}
                onClick={() => setTab(s.symbol)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  tab === s.symbol
                    ? "bg-white/[0.12] font-medium text-ink"
                    : "text-muted hover:bg-white/[0.05] hover:text-ink2"
                }`}
              >
                <span className="h-2 w-2 rounded-sm" style={{ background: symbolColor(s.symbol) }} />
                {s.symbol}
                <span className={`tabular-nums text-[11px] ${toneOf(s.net)}`}>{m(s.net, true)}</span>
                {s.positions.length > 0 && (
                  <span className="rounded bg-s4/20 px-1 text-[10px] text-s4">{s.positions.length}</span>
                )}
              </button>
            ))}
          </div>

          {tab === "__all__" ? (
            <div className="space-y-4">
              {/* KPI grid */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                <Kpi
                  label={T.equity}
                  value={m(acc.equity)}
                  sub={`${T.balance} ${m(acc.balance)}`}
                  spark={equitySeries[0]?.points}
                />
                <Kpi
                  label={T.netProfit}
                  value={m(p.net, true)}
                  tone={p.net > 0 ? "pos" : p.net < 0 ? "neg" : "neutral"}
                  sub={`${T.initial} ${m(acc.initialDeposit)}`}
                />
                <Kpi
                  label={T.floating}
                  value={m(p.floating, true)}
                  tone={p.floating > 0 ? "pos" : p.floating < 0 ? "neg" : "neutral"}
                  sub={`${p.openCount} ${T.openPositions} · ${num(p.openLots, 2)} lot`}
                />
                <Kpi
                  label={T.growth}
                  value={pct(p.growth, 2, true)}
                  tone={p.growth > 0 ? "pos" : p.growth < 0 ? "neg" : "neutral"}
                  sub={
                    range === "all"
                      ? `${T.trades} ${p.trades}`
                      : `${T.trades} ${p.trades} · ${T.growthBase} ${m(p.base)}`
                  }
                />
                <Kpi
                  label={T.winRate}
                  value={pct(p.winRate, 1)}
                  sub={`${p.wins} ${T.wins} / ${p.losses} ${T.losses}`}
                />
                <Kpi
                  label={T.profitFactor}
                  value={p.profitFactor === null ? "∞" : num(p.profitFactor, 2)}
                  sub={`${T.maxDD} ${m(p.maxDD)} (${pct(p.maxDDPct, 1)})`}
                />
              </div>

              {/* equity curve */}
              <Card
                title={T.equityCurve}
                right={
                  <div className="flex gap-3 text-[11px] text-muted">
                    {equitySeries.map((s) => (
                      <span key={s.key} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                }
              >
                <LineChart
                  height={300}
                  series={equitySeries}
                  formatY={(v) => m(v)}
                  formatX={fmtX}
                />
              </Card>

              <div className="grid items-start gap-4 lg:grid-cols-3">
                <Card title={T.profitBySymbol} className="lg:col-span-2">
                  <BarChart
                    height={230}
                    data={model.bySymbol.map((s) => ({
                      label: s.symbol,
                      value: s.net,
                      color: symbolColor(s.symbol),
                      sub: `${s.trades} ${T.trades} · ${pct(s.winRate, 1)} win`,
                    }))}
                    formatValue={(v) => m(v)}
                  />
                </Card>

                <Card title={T.shareBySymbol}>
                  <Donut
                    data={model.bySymbol
                      .filter((s) => s.net > 0)
                      .map((s) => ({
                        label: s.symbol,
                        value: s.net,
                        color: symbolColor(s.symbol),
                      }))}
                    formatValue={(v) => m(v)}
                  />
                  <div className="mt-3 space-y-1">
                    {model.bySymbol.map((s) => (
                      <div key={s.symbol} className="flex items-center gap-2 text-xs">
                        <span className="h-2 w-2 rounded-sm" style={{ background: symbolColor(s.symbol) }} />
                        <span className="text-ink2">{s.symbol}</span>
                        <span className={`ml-auto tabular-nums ${toneOf(s.net)}`}>{m(s.net, true)}</span>
                        <span className="w-12 text-right tabular-nums text-muted">
                          {s.net > 0 ? pct(s.shareOfProfit, 0) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* per-symbol summary table */}
              <Card title={T.symbolBreakdown} subtitle={T.perSymbolNote}>
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr className="border-b border-hair">
                        {[T.symbol, T.ea, T.trades, T.winRate, T.netProfit, T.floating, T.profitFactor, T.maxDD, T.expectancy, T.openLots, T.share].map(
                          (h, i) => (
                            <th
                              key={h + i}
                              className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted ${
                                i < 2 ? "text-left" : "text-right"
                              }`}
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {model.bySymbol.map((s) => (
                        <tr
                          key={s.symbol}
                          onClick={() => setTab(s.symbol)}
                          className="cursor-pointer border-b border-hair/60 last:border-0 hover:bg-white/[0.04]"
                        >
                          <td className="px-3 py-2 text-sm font-medium text-ink">
                            <span className="mr-2 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: symbolColor(s.symbol) }} />
                            {s.symbol}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{s.eas.join(", ") || s.magics.join(", ") || "—"}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-ink2">{s.trades}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-ink2">{pct(s.winRate, 1)}</td>
                          <td className={`px-3 py-2 text-right text-sm font-medium tabular-nums ${toneOf(s.net)}`}>{m(s.net, true)}</td>
                          <td className={`px-3 py-2 text-right text-sm tabular-nums ${toneOf(s.floating)}`}>{s.positions.length ? m(s.floating, true) : "—"}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-ink2">{s.profitFactor === null ? "∞" : num(s.profitFactor, 2)}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-ink2">{m(s.maxDD)}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-ink2">{m(s.expectancy, true)}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-ink2">{num(s.openLots, 2)}</td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums text-muted">
                            {s.net > 0 ? pct(s.shareOfProfit, 0) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <TradingCalendar
                deals={raw?.deals || []}
                initial={acc.initialDeposit || 0}
                T={T}
                lang={lang}
                m={m}
                tzOffset={tzOffset}
                digitsFor={digitsFor}
                selected={calDay}
                onSelect={setCalDay}
              />

              {/* the calendar takes the full width, so these run in columns instead */}
              <Card title={T.deepStats} bodyClass="p-4 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label={T.grossProfit} value={m(p.grossProfit)} tone="pos" />
                <Stat label={T.grossLoss} value={m(-p.grossLoss)} tone="neg" />
                <Stat label={T.avgWin} value={m(p.avgWin)} tone="pos" />
                <Stat label={T.avgLoss} value={m(-p.avgLoss)} tone="neg" />
                <Stat label={T.expectancy} value={m(p.expectancy, true)} />
                <Stat label={T.avgHold} value={duration(p.avgHoldMin, lang)} />
                <Stat label={T.totalLots} value={num(p.volume, 2)} />
                <Stat label={T.margin} value={m(acc.margin)} />
                <Stat label={T.freeMargin} value={m(acc.freeMargin)} />
                <Stat label={T.marginLevel} value={acc.marginLevel ? pct(acc.marginLevel, 0) : "—"} />
              </Card>

              <Card title={T.openPositions} subtitle={`${p.openCount} · ${num(p.openLots, 2)} lot`}>
                <PositionsTable rows={model.positions} T={T} m={m} digitsFor={digitsFor} tzOffset={tzOffset} />
              </Card>

              <Card title={T.closedDeals}>
                <DealsTable rows={model.deals} T={T} m={m} lang={lang} digitsFor={digitsFor} tzOffset={tzOffset} />
              </Card>
            </div>
          ) : (
            (() => {
              const s = model.bySymbol.find((x) => x.symbol === tab);
              if (!s) return null;
              return (
                <SymbolPanel
                  s={s}
                  T={T}
                  lang={lang}
                  m={m}
                  color={symbolColor(s.symbol)}
                  digitsFor={digitsFor}
                  tzOffset={tzOffset}
                />
              );
            })()
          )}
        </>
      )}

      <footer className="mt-8 border-t border-hair pt-4 text-[11px] text-muted">
        MT5 Portfolio Dashboard · {T.updated} {formatDateTime(model?.updatedAt, tzOffset)} {tzName} ·{" "}
        {raw?.source === "kv" ? "Vercel KV" : raw?.source === "demo" ? T.demo : "memory store"}
      </footer>
    </main>
  );
}
