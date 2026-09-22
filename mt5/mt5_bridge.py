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

# MT5 ไม่มี "ตั้งแต่เริ่มบัญชี" ให้ใช้ตรงๆ — ส่งวันที่เก่ากว่าบัญชีไหนๆ ไปแทน
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# ถ้า MT5 เปิดอยู่หลายตัว ระบุ path ของ terminal64.exe ได้
TERMINAL = os.environ.get("MT5_TERMINAL_PATH") or None

# เวลาเซิร์ฟเวอร์โบรกเกอร์ห่างจาก UTC กี่ชั่วโมง (เช่น 3 = GMT+3)
# ว่างไว้ = ตรวจจับเองจาก tick ล่าสุด
_ENV_OFFSET = os.environ.get("MT5_SERVER_GMT_OFFSET", "").strip()
SERVER_OFFSET_SEC = int(float(_ENV_OFFSET) * 3600) if _ENV_OFFSET else 0
OFFSET_KNOWN = bool(_ENV_OFFSET)

_probe_cache = None


def probe_symbols():
    """ชื่อ symbol ที่มีจริงในบัญชีนี้ เอาไว้ขอ tick ล่าสุด

    ห้ามฮาร์ดโค้ด "EURUSD" — บัญชี cent ของ HFM ใช้ XAUUSDc, โบรกอื่นมี .m/.raw/_ecn
    ต่อท้าย ขอ tick ด้วยชื่อที่ไม่มีอยู่จริงจะได้ None เงียบๆ แล้วหา offset ไม่เจอ
    รายชื่อไม่เปลี่ยนระหว่างรัน จึงหาครั้งเดียวพอ
    """
    global _probe_cache
    if _probe_cache is None:
        names = [p.symbol for p in (mt5.positions_get() or [])]
        watch = mt5.symbols_get() or []
        names += [s.name for s in watch if s.visible]   # Market Watch มาก่อน มี tick แน่
        names += [s.name for s in watch if not s.visible]
        _probe_cache = list(dict.fromkeys(names))[:15]
    return _probe_cache


_offset_checked_at = 0.0


def detect_server_offset():
    """เดาว่านาฬิกาเซิร์ฟเวอร์โบรกเกอร์เร็วกว่า UTC กี่วินาที

    MT5 ฝั่ง Python คืนเวลาทุกอย่างเป็น "เวลาเซิร์ฟเวอร์" แต่ไม่มี API บอกว่า
    เซิร์ฟเวอร์อยู่โซนไหน — tick ที่เพิ่งเข้ามาคือ "ตอนนี้" ของโบรกเกอร์ ดังนั้น
    ส่วนต่างกับ UTC จริงคือ offset ปัดเป็นทีละ 15 นาที ถ้า tick เก่า (ตลาดปิด /
    สัญลักษณ์ไม่มีในบัญชี) ผลจะเพี้ยน จึงทิ้งไปแล้วใช้ค่าที่รู้ล่าสุดแทน
    """
    global SERVER_OFFSET_SEC, OFFSET_KNOWN, _offset_checked_at
    if _ENV_OFFSET:
        return SERVER_OFFSET_SEC
    # รู้ offset แล้วก็เช็คซ้ำแค่ทุก 10 นาที พอสำหรับจับ DST ที่ปีละสองครั้ง
    if OFFSET_KNOWN and time.time() - _offset_checked_at < 600:
        return SERVER_OFFSET_SEC
    _offset_checked_at = time.time()

    newest = None
    for name in probe_symbols():
        tick = mt5.symbol_info_tick(name)
        if tick and tick.time and (newest is None or tick.time > newest):
            newest = tick.time
    if newest is None:
        warn_offset("ขอ tick ไม่ได้เลย")
        return SERVER_OFFSET_SEC

    diff = newest - time.time()
    guess = round(diff / 900) * 900
    # tick ที่ค้างเป็นชั่วโมง/เป็นวันจะให้ค่าที่อยู่นอกช่วงโซนเวลาจริง หรือเหลือเศษเยอะ
    if abs(guess) > 14 * 3600 or abs(diff - guess) > 600:
        warn_offset("tick ล่าสุดเก่าเกินไป (ตลาดปิดอยู่?)")
        return SERVER_OFFSET_SEC

    if guess != SERVER_OFFSET_SEC or not OFFSET_KNOWN:
        print(f"[bridge] เวลาเซิร์ฟเวอร์ = UTC{guess / 3600:+g} ชม.")
    SERVER_OFFSET_SEC = guess
    OFFSET_KNOWN = True
    return SERVER_OFFSET_SEC


_thb_pair = None   # (ชื่อ symbol, ต้องกลับเศษส่วนไหม) — None = ยังไม่ได้หา


def thb_candidates():
    """คู่เงินที่แปลง USD -> THB ได้ เรียงตามความน่าเชื่อถือ

    ดูจาก "สกุลเงินของคู่" ที่ MT5 บอกมาตรงๆ ไม่ใช่จากชื่อ เพราะชื่อแล้วแต่โบรก
    (USDTHB, USDTHBc, USDTHB.m, USDTHB.raw, USD/THB, mUSDTHB ...) ใช้ชื่อเป็น
    ตัวตัดสินเมื่อไหร่ก็พังกับโบรกถัดไปเมื่อนั้น
    """
    direct, inverse, by_name = [], [], []
    for s in mt5.symbols_get() or []:
        base = (getattr(s, "currency_base", "") or "").upper()
        quote = (getattr(s, "currency_profit", "") or "").upper()
        if base == "USD" and quote == "THB":
            direct.append((s.name, False))
        elif base == "THB" and quote == "USD":
            inverse.append((s.name, True))       # คู่กลับด้าน ใช้ 1/ราคา
        else:
            # เผื่อโบรกไม่ได้ใส่ข้อมูลสกุลเงินมา ค่อยเดาจากชื่อเป็นทางสุดท้าย
            plain = "".join(c for c in s.name.upper() if c.isalnum())
            if "USDTHB" in plain:
                by_name.append((s.name, False))
    return direct + by_name + inverse


def quote_of(name):
    """ราคากลาง bid/ask ของ symbol — อ่านจากที่เทอร์มินัลถืออยู่ ไม่ได้ subscribe อะไร"""
    tick = mt5.symbol_info_tick(name)
    if tick and tick.bid and tick.ask:
        return (tick.bid + tick.ask) / 2
    info = mt5.symbol_info(name)
    return info.bid if info and info.bid else None


def usd_thb():
    """เรต USD→THB จากฟีดโบรกเอง (ราคาตอนนั้นจริงๆ ไม่ต้องพึ่งเว็บนอก)

    โบรกไหนไม่มีคู่ THB ก็ส่ง None ไป แล้วให้ dashboard ไปดึงจาก /api/fx เอง
    """
    global _thb_pair
    if _thb_pair is None:
        _thb_pair = ("", False)
        for name, invert in thb_candidates():
            if quote_of(name):                   # เอาตัวที่มีราคาจริงเท่านั้น
                _thb_pair = (name, invert)
                print(f"[bridge] เรตบาทจากฟีดโบรก: {name}{' (คู่กลับด้าน)' if invert else ''}")
                break
        else:
            print("[bridge] โบรกนี้ไม่มีคู่ USD/THB — dashboard จะไปดึงเรตเอง")

    name, invert = _thb_pair
    if not name:
        return None
    price = quote_of(name)
    if not price:
        return None
    return round(1 / price if invert else price, 4)


_warned = False


def warn_offset(why):
    """เตือนครั้งเดียว: ถ้าหา offset ไม่ได้ วันบน dashboard จะเลื่อนไปทั้งแผง"""
    global _warned
    if _warned or OFFSET_KNOWN:
        return
    _warned = True
    print(f"[bridge] เตือน: หาเวลาเซิร์ฟเวอร์ไม่ได้ ({why}) — ใช้ UTC ไปก่อน "
          f"ถ้าผิดให้ตั้ง MT5_SERVER_GMT_OFFSET เอง")


def iso(ts):
    """เวลาจาก MT5 เป็นเวลาเซิร์ฟเวอร์ — เก็บลง dashboard เป็น UTC จริงเสมอ"""
    return datetime.fromtimestamp(ts - SERVER_OFFSET_SEC, tz=timezone.utc).isoformat()


_last_capital = None


def account_capital(balance, funding, funding_ops, trade_net_all):
    """ทุนของบัญชี = เงินที่ใส่เข้าไปจริง (ฝากทั้งหมด − ถอนทั้งหมด)

    เดิมคิดจาก balance − กำไรที่ปิดแล้ว "ใน HISTORY_DAYS ล่าสุด" ซึ่งเพี้ยนทันทีที่
    บัญชีมีอายุเกินกรอบนั้น เพราะกำไรที่เก่ากว่าจะถูกนับเป็นทุนไปด้วย แล้วยิ่งเติมเงิน
    เข้าไปก็ยิ่งมองไม่ออกว่าตัวเลขที่ขึ้นมาคือทุนหรือกำไรเก่า

    ตอนนี้อ่านจากรายการฝาก/ถอนตรงๆ ซึ่งเป็นตัวเลขที่ไม่ต้องเดา ถ้าโบรกไม่คืน
    รายการพวกนั้นมา (บางที่ตัดประวัติเก่าทิ้ง) ค่อยถอยไปใช้ balance − กำไรทั้งหมด
    ซึ่งตอนนี้นับจากประวัติเต็มแล้ว ไม่ใช่แค่ 120 วัน
    """
    global _last_capital
    if INITIAL_DEPOSIT > 0:
        return INITIAL_DEPOSIT

    if funding_ops and funding > 0:
        capital = round(funding, 2)
        source = f"ฝาก/ถอน {funding_ops} รายการ"
    else:
        capital = round(balance - trade_net_all, 2)
        source = "balance − กำไรทั้งหมด (ไม่เห็นรายการฝาก/ถอน)"

    if capital != _last_capital:
        print(f"[bridge] ทุนบัญชี = {capital:,.2f} ({source})")
        _last_capital = capital
    return capital


def collect():
    detect_server_offset()
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

    # ช่วงเวลาที่ส่งให้ MT5 ต้องเป็น "เวลาเซิร์ฟเวอร์" ไม่ใช่ UTC
    srv_now = datetime.now(timezone.utc) + timedelta(seconds=SERVER_OFFSET_SEC)
    # ดึงประวัติ "ทั้งหมด" ครั้งเดียว แล้วค่อยตัดเฉพาะ HISTORY_DAYS ตอนส่ง
    # เพราะทุนเริ่มต้นต้องมองเห็นรายการฝากเงินตั้งแต่วันแรก ไม่ใช่แค่ในกรอบล่าสุด
    history = mt5.history_deals_get(EPOCH, srv_now + timedelta(hours=1)) or []
    if not history:
        # กันเหนียว: บางเทอร์มินัลไม่ยอมช่วงเวลากว้างขนาดนี้ ถอยไปใช้กรอบเดิมแทน
        # ไม่งั้นจะกลายเป็นส่งประวัติเปล่าขึ้น dashboard
        history = mt5.history_deals_get(
            srv_now - timedelta(days=HISTORY_DAYS), srv_now + timedelta(hours=1)
        ) or []
    window_from = (srv_now - timedelta(days=HISTORY_DAYS)).timestamp()

    # ฝาก/ถอนจริง กับกำไรขาดทุนจากการเทรดตลอดอายุบัญชี — แยกกันให้ชัด
    funding = 0.0
    funding_ops = 0
    trade_net_all = 0.0
    for d in history:
        if d.type == mt5.DEAL_TYPE_BALANCE:
            funding += d.profit          # ถอนเงินมาเป็นค่าติดลบอยู่แล้ว
            funding_ops += 1
        elif d.type != mt5.DEAL_TYPE_CREDIT:
            # ทุก deal นับครั้งเดียว ค่าคอมของไม้ตอนเปิดจึงไม่ถูกบวกซ้ำ
            trade_net_all += d.profit + d.swap + d.commission

    opens = {}
    for d in history:
        if d.entry == mt5.DEAL_ENTRY_IN and d.symbol:
            opens[d.position_id] = d

    deals = []
    for d in history:
        if d.entry not in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY):
            continue
        if not d.symbol:
            continue
        if d.time < window_from:
            continue
        o = opens.get(d.position_id)
        commission = d.commission + (o.commission if o else 0.0)
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

    initial = account_capital(acc.balance, funding, funding_ops, trade_net_all)

    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "usdThb": usd_thb(),
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
            # dashboard นับ "วัน" ตามนาฬิกานี้ (เที่ยงคืนเซิร์ฟเวอร์ = 17:00 นิวยอร์ก)
            "tzOffsetMin": SERVER_OFFSET_SEC // 60,
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
