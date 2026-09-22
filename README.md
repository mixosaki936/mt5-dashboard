# MT5 Portfolio Dashboard

หน้าเว็บดูพอร์ต MT5 — แสดง **ภาพรวมทั้งพอร์ต** และ **แยกรายคู่เงินที่ EA เปิด**
(ทุกคู่อยู่ในบัญชีเดียวกัน แต่ดูแยกได้ว่าแต่ละคู่ทำกำไร/ขาดทุนเท่าไหร่)

พร้อม deploy ขึ้น Vercel — Next.js 14 (App Router) + Tailwind, ไม่มี dependency ของกราฟ (วาด SVG เอง)

---

## 1. Deploy ขึ้น Vercel

```bash
cd mt5-dashboard
git init && git add -A && git commit -m "init"
# push ขึ้น GitHub แล้วกด Import ใน Vercel
```
หรือเร็วกว่า:
```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

### Environment variables (ตั้งใน Vercel > Settings > Environment Variables)

| ตัวแปร | จำเป็น | ความหมาย |
|---|---|---|
| `INGEST_TOKEN` | **ควรตั้ง** | รหัสลับที่ EA ต้องส่งมาด้วย ไม่งั้นใครก็ยิงข้อมูลเข้ามาได้ |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | แนะนำ | ถ้าต่อ Vercel KV / Upstash Redis ข้อมูลจะไม่หายตอน serverless รีสตาร์ท |
| `DEMO_DATA` | ไม่ | ใส่ `off` เพื่อปิดข้อมูลตัวอย่าง (ค่าเริ่มต้นคือเปิด จนกว่าจะมีข้อมูลจริงเข้ามา) |

> **ถ้าไม่ต่อ KV**: ข้อมูลเก็บใน memory ของ serverless function — ใช้ได้ แต่จะหายเมื่อ Vercel รีไซเคิล instance
> (ไม่เป็นไรมากถ้า EA ยิงทุก 60 วิ เพราะเดี๋ยวก็ส่งมาใหม่ แต่เส้น equity history จะเริ่มนับใหม่)
> วิธีต่อ: Vercel > Storage > Create KV แล้ว Connect เข้า project — ตัวแปรจะถูกใส่ให้อัตโนมัติ

---

## 2. ส่งข้อมูลจาก MT5 — เลือกทางใดทางหนึ่ง

ไม่จำเป็นต้องเป็น EA เท่านั้น ทั้งสองทางส่ง JSON หน้าตาเดียวกันมาที่ `POST /api/report`

### ทาง A — EA ตัวแยก (`mt5/DashboardReporter.mq5`) ✅ แนะนำ

ไม่ต้องแก้ EA เทรดเดิมเลย แค่เอา EA ตัวนี้แปะบนชาร์ตไหนก็ได้อีก 1 ชาร์ต
มันอ่านข้อมูล **ทั้งบัญชี** — ทุกคู่ ทุก magic ทุก EA

1. copy `DashboardReporter.mq5` ไปไว้ใน `MQL5/Experts/` แล้วกด Compile ใน MetaEditor
2. **Tools > Options > Expert Advisors** → ติ๊ก *Allow WebRequest for listed URL* → ใส่ `https://your-app.vercel.app`
3. ลากใส่ชาร์ต แล้วตั้งค่า:
   - `InpUrl` = `https://your-app.vercel.app/api/report`
   - `InpToken` = ค่าเดียวกับ `INGEST_TOKEN`
   - `InpIntervalSec` = 60
   - `InpInitialDeposit` = ทุนเริ่มต้นจริง (ใส่ 0 ให้คำนวณเอง)

### ทาง B — สคริปต์ Python (`mt5/mt5_bridge.py`)

เหมาะถ้าไม่อยากแตะอะไรใน MT5 เลย (รันข้างนอก ใช้ library `MetaTrader5`)

```cmd
pip install MetaTrader5 requests
set DASHBOARD_URL=https://your-app.vercel.app/api/report
set INGEST_TOKEN=xxxxx
python mt5_bridge.py
```
ตั้งเป็น Task Scheduler / NSSM ให้รันค้างไว้ได้

### ทาง C — ยิงเองด้วย curl (ทดสอบ)

```bash
curl -X POST https://your-app.vercel.app/api/report \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: xxxxx" \
  -d @sample-payload.json
```

---

## 3. รูปแบบ JSON ที่ API รับ

รับได้ทั้ง `camelCase` และ `snake_case`, เวลาเป็น ISO string หรือ epoch วินาทีก็ได้
ช่องไหนไม่มีก็ข้ามได้ (`initialDeposit` ถ้าไม่ส่ง จะคำนวณจาก balance − กำไรที่ปิดแล้ว)

```jsonc
{
  "updatedAt": "2026-09-15T08:30:00Z",
  "account": {
    "login": 5090211, "server": "ICMarkets-Live", "currency": "USD", "leverage": 500,
    "balance": 10450.25, "equity": 10492.10, "margin": 412.5, "freeMargin": 10079.6,
    "marginLevel": 2543.5, "initialDeposit": 10000,
    "tzOffsetMin": 180          // เวลาเซิร์ฟเวอร์โบรกห่างจาก UTC กี่นาที (ไม่ส่งก็ได้)
  },
  "positions": [{
    "ticket": 600201, "symbol": "XAUUSD", "type": "BUY", "volume": 0.15,
    "openPrice": 3318.4, "currentPrice": 3321.2, "sl": 3310.0, "tp": 3335.0,
    "profit": 42.8, "swap": -0.3, "commission": -1.05,
    "openTime": "2026-09-15T07:55:00Z", "magic": 20250101, "comment": "GoldScalperSMC"
  }],
  "deals": [{
    "ticket": 500123, "symbol": "XAUUSD", "type": "SELL", "volume": 0.1,
    "openPrice": 3325.1, "closePrice": 3319.7, "profit": 54.0, "swap": -0.2, "commission": -0.7,
    "openTime": "2026-09-14T13:02:00Z", "closeTime": "2026-09-14T14:11:00Z",
    "magic": 20250101, "comment": "GoldScalperSMC"
  }]
}
```

**การแยกคู่เงินเกิดขึ้นอัตโนมัติจากฟิลด์ `symbol`** — มีกี่คู่ก็ขึ้นแท็บให้เท่านั้น
ส่วน `magic` / `comment` จะโชว์เป็นป้ายบอกว่า EA ตัวไหนเปิดไม้นั้น

---

## 4. สิ่งที่หน้าเว็บคำนวณให้

**ระดับพอร์ต:** Equity / Balance / ทุนเริ่มต้น / กำไรสุทธิ / กำไรลอย / % การเติบโต /
Win rate / Profit Factor / Max Drawdown / เส้น equity curve / กำไรรายวัน /
Margin, Free margin, Margin level

**ระดับรายคู่ (แท็บแยกแต่ละ symbol):** กำไรสุทธิและสัดส่วนของพอร์ต / Win rate / PF /
Max DD ของคู่นั้น / expectancy ต่อไม้ / กราฟกำไรสะสม / กำไรตามชั่วโมง (เวลาตลาด) /
แยกฝั่ง Buy–Sell / กำไร-ขาดทุนเฉลี่ย / R:R / ไม้ชนะ-แพ้ติดกันสูงสุด / เวลาถือเฉลี่ย /
ตารางไม้ที่เปิดอยู่ / ตารางประวัติการเทรด (ดาวน์โหลด CSV ได้)

ตัวกรองช่วงเวลา (วันนี้ / 7 / 30 / 90 วัน / เดือนนี้ / ทั้งหมด), สลับ USD–THB (ตั้งเรตเองได้),
สลับภาษา TH/EN, auto-refresh 30/60/300 วินาที

### เวลาตลาด (การนับ "วัน")

ข้อมูลทุกอย่างเก็บเป็น UTC จริง แต่หน้าเว็บ **นับวันตามนาฬิกาตลาด ไม่ใช่เวลาเครื่อง** —
เที่ยงคืนของเซิร์ฟเวอร์โบรก คือจังหวะ 17:00 นิวยอร์ก ซึ่งเป็นจุดที่วันเทรดหนึ่งจบและวันใหม่เริ่ม
(นี่คือเหตุผลที่โบรก GMT+3 หน้าร้อนจะกลายเป็น GMT+2 หน้าหนาว — จุดตัดวันอยู่ที่เดิม)

สิ่งที่ยึดเวลาตลาดทั้งหมด: ตัวกรอง "วันนี้" / "เดือนนี้", กราฟกำไรรายวัน,
กำไรตามชั่วโมง, เวลาที่แสดงในตาราง และไฟล์ CSV ที่ดาวน์โหลด

เลือกนาฬิกาได้ที่หัวหน้าเว็บ (`เวลาตลาด`) — ค่าเริ่มต้นคือ **เซิร์ฟเวอร์โบรก** ซึ่งอ่านจาก
`tzOffsetMin` ที่ EA/bridge ส่งมา (ไม่มีค่านี้ จะถือว่า GMT+3) หรือจะบังคับเป็น GMT+0…+3
หรือเวลาเครื่องก็ได้ ค่าที่เลือกจำไว้ในเบราว์เซอร์

ฝั่ง bridge Python หา offset เองจาก tick ล่าสุด ถ้าอยากกำหนดเองให้ตั้ง
`set MT5_SERVER_GMT_OFFSET=3` ก่อนรัน

### เรตเงินบาท

กดปุ่ม THB แล้วเรตจะมาเองตามลำดับนี้

1. **ฟีดโบรก** — ถ้าโบรกมีคู่ USD/THB bridge จะส่งราคากลาง bid/ask มาให้ทุกรอบ
   อันนี้คือราคาตลาดจริง ณ ตอนนั้น หาคู่นี้จาก**สกุลเงินที่ MT5 บอก** ไม่ใช่จากชื่อ
   ฉะนั้นจะชื่อ `USDTHB`, `USDTHBc`, `USDTHB.m`, `USD/THB` หรืออะไรก็ใช้ได้หมด
   (โบรกที่มีแต่คู่กลับด้าน `THBUSD` ก็รองรับ)
2. **`/api/fx`** — ถ้าไม่มีคู่นั้น หน้าเว็บจะไปดึงจาก frankfurter.dev (อิง ECB) และถ้าล่ม
   จะถอยไป open.er-api.com ทั้งคู่ฟรี ไม่ต้องใช้ API key อัปเดตวันละครั้ง
   แคชไว้ฝั่งเซิร์ฟเวอร์ 1 ชั่วโมง
3. **กรอกเอง** — กดปุ่ม `กรอกเอง` ข้างช่องเรต แล้วพิมพ์ตัวเลขที่ต้องการ (จำไว้ในเบราว์เซอร์)

ชี้เมาส์ค้างที่ช่องเรตจะบอกว่าเลขนั้นมาจากไหนและอัปเดตเมื่อไหร่

---

## 5. หลายบัญชี / หลายเครื่อง

รองรับอยู่แล้ว — ไม่ต้องตั้งค่าอะไรเพิ่ม

แต่ละ snapshot ถูกเก็บแยกตาม `account.login` ที่ส่งมา (key `mt5:snapshot:<login>`)
ดังนั้นจะรัน bridge/EA กี่เครื่องกี่บัญชีก็ได้ ยิงมาที่ URL เดียวกัน ไม่ทับกัน
พอมีมากกว่า 1 บัญชี หน้าเว็บจะมี **dropdown เลือกบัญชี** โผล่ขึ้นมาที่มุมขวาบน

- เปิดหน้าเว็บเฉยๆ = บัญชีที่ส่งข้อมูลมาล่าสุด
- เลือกเจาะจงได้ทาง UI หรือ `GET /api/report?account=<login>`
- `GET /api/report` แถม field `accounts` มาด้วย เป็นรายชื่อบัญชีทั้งหมดที่เคยส่งเข้ามา
- กราฟ equity ของแต่ละบัญชีสะสมแยกกัน ไม่รีเซ็ตเวลาอีกบัญชีส่งเข้ามา

> เปลี่ยน prefix ของ key ได้ด้วย env `SNAPSHOT_KEY` (default `mt5:snapshot`)
> ใช้ตอนอยากให้ project เดียวกันแยก dataset เช่น staging กับ production

---

## 6. รันในเครื่อง

```bash
npm install
npm run dev     # http://localhost:3000
```
ยังไม่มีข้อมูลจริง หน้าเว็บจะโชว์ **ข้อมูลตัวอย่าง** ให้ดูหน้าตาก่อน
พอมีข้อมูลจริง POST เข้ามา มันจะสลับไปใช้ข้อมูลจริงทันที

## หมายเหตุเรื่องความปลอดภัย

- `GET /api/report` เปิดสาธารณะ (หน้าเว็บต้องอ่านได้) — ใครมี URL ก็เห็นตัวเลขพอร์ต
  ถ้าไม่อยากให้คนอื่นเห็น ใช้ Vercel Password Protection (Pro) หรือเพิ่ม middleware ตรวจรหัสผ่านเอง
- `POST /api/report` ป้องกันด้วย `INGEST_TOKEN` — **ตั้งเสมอ** ก่อนขึ้น production
