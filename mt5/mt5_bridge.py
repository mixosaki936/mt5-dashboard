"""
mt5_bridge.py — ทางเลือกที่ไม่ต้องแตะ EA เดิม

รันบนเครื่อง Windows ที่เปิด MT5 อยู่ (เครื่องเดียวกับที่รัน EA)
สคริปต์จะอ่านบัญชี/ไม้ที่เปิด/ประวัติ แล้วยิงไปที่ dashboard ทุก N วินาที

ติดตั้ง:
    pip install MetaTrader5 requests

รัน:
    set DASHBOARD_URL=https://your-app.vercel.app/api/report
    set INGEST_TOKEN=xxxxx
    python mt5_bridge.py
"""

import os
import time
from datetime import datetime, timedelta, timezone

import requests
import MetaTrader5 as mt5

URL = os.environ.get("DASHBOARD_URL", "https://your-app.vercel.app/api/report")
TOKEN = os.environ.get("INGEST_TOKEN", "")
INTERVAL = int(os.environ.get("INTERVAL_SEC", "60"))
HISTORY_DAYS = int(os.environ.get("HISTORY_DAYS", "120"))
INITIAL_DEPOSIT = float(os.environ.get("INITIAL_DEPOSIT", "0"))  # 0 = auto

# ถ้า MT5 เปิดอยู่หลายตัว ระบุ path ของ terminal64.exe ได้
TERMINAL = os.environ.get("MT5_TERMINAL_PATH") or None


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def collect():
    acc = mt5.account_info()
    if acc is None:
        raise RuntimeError(f"account_info() ล้มเหลว: {mt5.last_error()}")

    positions = []
    for p in mt5.positions_get() or []:
        positions.append({
            "ticket": p.ticket,
            "symbol": p.symbol,
            "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
            "volume": p.volume,
            "openPrice": p.price_open,
            "currentPrice": p.price_current,
            "sl": p.sl,
            "tp": p.tp,
            "profit": p.profit,
            "swap": p.swap,
            "commission": 0.0,
            "openTime": iso(p.time),
            "magic": p.magic,
            "comment": p.comment,
        })

    frm = datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)
    raw = mt5.history_deals_get(frm, datetime.now(timezone.utc) + timedelta(hours=1)) or []

    opens = {}
    for d in raw:
        if d.entry == mt5.DEAL_ENTRY_IN:
            opens[d.position_id] = d

    deals = []
    closed_net = 0.0
    for d in raw:
        if d.entry not in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY):
            continue
        if not d.symbol:
            continue
        o = opens.get(d.position_id)
        commission = d.commission + (o.commission if o else 0.0)
        closed_net += d.profit + d.swap + commission
        deals.append({
            "ticket": d.ticket,
            "positionId": d.position_id,
            "symbol": d.symbol,
            # ไม้ที่ปิดด้วย SELL คือไม้ BUY
            "type": "BUY" if d.type == mt5.DEAL_TYPE_SELL else "SELL",
            "volume": d.volume,
            "openPrice": o.price if o else 0.0,
            "closePrice": d.price,
            "profit": d.profit,
            "swap": d.swap,
            "commission": commission,
            "openTime": iso(o.time) if o else iso(d.time),
            "closeTime": iso(d.time),
            "magic": d.magic,
            "comment": (d.comment or "") or (o.comment if o else ""),
        })

    initial = INITIAL_DEPOSIT if INITIAL_DEPOSIT > 0 else round(acc.balance - closed_net, 2)

    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "account": {
            "login": acc.login,
            "name": acc.name,
            "server": acc.server,
            "company": acc.company,
            "currency": acc.currency,
            "leverage": acc.leverage,
            "balance": acc.balance,
            "equity": acc.equity,
            "credit": acc.credit,
            "margin": acc.margin,
            "freeMargin": acc.margin_free,
            "marginLevel": acc.margin_level,
            "initialDeposit": initial,
        },
        "positions": positions,
        "deals": deals,
    }


def main():
    ok = mt5.initialize(TERMINAL) if TERMINAL else mt5.initialize()
    if not ok:
        raise SystemExit(f"เชื่อมต่อ MT5 ไม่ได้: {mt5.last_error()}")

    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["X-Auth-Token"] = TOKEN

    print(f"[bridge] ส่งไปที่ {URL} ทุก {INTERVAL}s")
    try:
        while True:
            try:
                payload = collect()
                r = requests.post(URL, json=payload, headers=headers, timeout=20)
                print(
                    f"[{datetime.now():%H:%M:%S}] HTTP {r.status_code} "
                    f"positions={len(payload['positions'])} deals={len(payload['deals'])} "
                    f"{r.text[:120]}"
                )
            except Exception as e:  # noqa: BLE001
                print(f"[{datetime.now():%H:%M:%S}] error: {e}")
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        pass
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
