//+------------------------------------------------------------------+
//|  DashboardReporter.mq5                                           |
//|  วาง EA ตัวนี้บนชาร์ตไหนก็ได้ 1 ชาร์ต (เช่น XAUUSD M1)            |
//|  มันจะอ่านข้อมูล "ทั้งบัญชี" — ทุกคู่เงิน ทุก EA ทุก magic         |
//|  แล้วยิง JSON ไปที่ /api/report ของ dashboard                     |
//|                                                                  |
//|  สำคัญ: Tools > Options > Expert Advisors                        |
//|         ติ๊ก "Allow WebRequest for listed URL"                    |
//|         แล้วใส่ https://your-app.vercel.app                       |
//+------------------------------------------------------------------+
#property copyright "MT5 Portfolio Dashboard"
#property version   "1.00"
#property strict

input string InpUrl             = "https://your-app.vercel.app/api/report"; // Dashboard URL
input string InpToken           = "";        // INGEST_TOKEN (ต้องตรงกับที่ตั้งบน Vercel)
input int    InpIntervalSec     = 60;        // ส่งทุกกี่วินาที
input int    InpHistoryDays     = 120;       // ดึงประวัติย้อนหลังกี่วัน
input double InpInitialDeposit  = 0;         // ทุนเริ่มต้น (0 = คำนวณอัตโนมัติ)
input bool   InpVerbose         = true;      // พิมพ์ log ทุกครั้งที่ส่ง

long g_tz_offset = 0;   // server time -> UTC (seconds; re-read every report so DST is picked up)

//+------------------------------------------------------------------+
int OnInit()
{
   g_tz_offset = (long)TimeTradeServer() - (long)TimeGMT();
   EventSetTimer(MathMax(5, InpIntervalSec));
   SendReport();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { SendReport(); }

//+------------------------------------------------------------------+
string JsonEscape(string s)
{
   string out = "";
   int n = StringLen(s);
   for(int i = 0; i < n; i++)
   {
      ushort c = StringGetCharacter(s, i);
      if(c == '"')       out += "\\\"";
      else if(c == '\\') out += "\\\\";
      else if(c == '\n' || c == '\r' || c == '\t') out += " ";
      else if(c < 32)    out += " ";
      else               out += ShortToString(c);
   }
   return out;
}

string Q(string key, string value) { return "\"" + key + "\":\"" + JsonEscape(value) + "\""; }
string N(string key, double value, int digits = 2)
{ return "\"" + key + "\":" + DoubleToString(value, digits); }
string L(string key, long value) { return "\"" + key + "\":" + IntegerToString(value); }

long ToUtc(datetime t) { return (long)t - g_tz_offset; }

//+------------------------------------------------------------------+
string BuildPositions()
{
   string arr = "";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string sym   = PositionGetString(POSITION_SYMBOL);
      int    dg    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      long   type  = PositionGetInteger(POSITION_TYPE);

      string row = "{";
      row += L("ticket", (long)ticket) + ",";
      row += Q("symbol", sym) + ",";
      row += Q("type", type == POSITION_TYPE_BUY ? "BUY" : "SELL") + ",";
      row += N("volume", PositionGetDouble(POSITION_VOLUME), 2) + ",";
      row += N("openPrice", PositionGetDouble(POSITION_PRICE_OPEN), dg) + ",";
      row += N("currentPrice", PositionGetDouble(POSITION_PRICE_CURRENT), dg) + ",";
      row += N("sl", PositionGetDouble(POSITION_SL), dg) + ",";
      row += N("tp", PositionGetDouble(POSITION_TP), dg) + ",";
      row += N("profit", PositionGetDouble(POSITION_PROFIT), 2) + ",";
      row += N("swap", PositionGetDouble(POSITION_SWAP), 2) + ",";
      row += N("commission", 0.0, 2) + ",";
      row += L("openTime", ToUtc((datetime)PositionGetInteger(POSITION_TIME))) + ",";
      row += L("magic", PositionGetInteger(POSITION_MAGIC)) + ",";
      row += Q("comment", PositionGetString(POSITION_COMMENT));
      row += "}";

      if(arr != "") arr += ",";
      arr += row;
   }
   return "[" + arr + "]";
}

//+------------------------------------------------------------------+
string BuildDeals(double &closed_net)
{
   closed_net = 0.0;

   datetime from = TimeCurrent() - (datetime)(InpHistoryDays * 86400);
   if(!HistorySelect(from, TimeCurrent() + 3600)) return "[]";

   int total = HistoryDealsTotal();

   // ---- pass 1: เก็บข้อมูลไม้ตอนเปิด (DEAL_ENTRY_IN) ----
   long   in_pos[];  double in_price[];  long in_time[];  double in_comm[];
   ArrayResize(in_pos, total); ArrayResize(in_price, total);
   ArrayResize(in_time, total); ArrayResize(in_comm, total);
   int in_count = 0;

   for(int i = 0; i < total; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;

      in_pos[in_count]   = (long)HistoryDealGetInteger(d, DEAL_POSITION_ID);
      in_price[in_count] = HistoryDealGetDouble(d, DEAL_PRICE);
      in_time[in_count]  = (long)HistoryDealGetInteger(d, DEAL_TIME);
      in_comm[in_count]  = HistoryDealGetDouble(d, DEAL_COMMISSION);
      in_count++;
   }

   // ---- pass 2: ไม้ที่ปิดแล้ว ----
   string arr = "";
   for(int i = 0; i < total; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;

      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;

      string sym = HistoryDealGetString(d, DEAL_SYMBOL);
      if(sym == "") continue;

      long   posId = (long)HistoryDealGetInteger(d, DEAL_POSITION_ID);
      long   dtype = HistoryDealGetInteger(d, DEAL_TYPE);
      int    dg    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(dg <= 0) dg = 5;

      double openPrice = 0.0, openComm = 0.0;
      long   openTime  = (long)HistoryDealGetInteger(d, DEAL_TIME);
      for(int k = 0; k < in_count; k++)
         if(in_pos[k] == posId)
         {
            openPrice = in_price[k];
            openTime  = in_time[k];
            openComm  = in_comm[k];
            break;
         }

      double profit = HistoryDealGetDouble(d, DEAL_PROFIT);
      double swap   = HistoryDealGetDouble(d, DEAL_SWAP);
      double comm   = HistoryDealGetDouble(d, DEAL_COMMISSION) + openComm;
      closed_net += profit + swap + comm;

      string row = "{";
      row += L("ticket", (long)d) + ",";
      row += L("positionId", posId) + ",";
      row += Q("symbol", sym) + ",";
      // ไม้ที่ปิดด้วย SELL คือไม้ BUY และกลับกัน
      row += Q("type", dtype == DEAL_TYPE_SELL ? "BUY" : "SELL") + ",";
      row += N("volume", HistoryDealGetDouble(d, DEAL_VOLUME), 2) + ",";
      row += N("openPrice", openPrice, dg) + ",";
      row += N("closePrice", HistoryDealGetDouble(d, DEAL_PRICE), dg) + ",";
      row += N("profit", profit, 2) + ",";
      row += N("swap", swap, 2) + ",";
      row += N("commission", comm, 2) + ",";
      row += L("openTime", ToUtc((datetime)openTime)) + ",";
      row += L("closeTime", ToUtc((datetime)HistoryDealGetInteger(d, DEAL_TIME))) + ",";
      row += L("magic", HistoryDealGetInteger(d, DEAL_MAGIC)) + ",";
      row += Q("comment", HistoryDealGetString(d, DEAL_COMMENT));
      row += "}";

      if(arr != "") arr += ",";
      arr += row;
   }
   return "[" + arr + "]";
}

//+------------------------------------------------------------------+
string BuildJson()
{
   // Broker clocks shift with DST, so refresh the offset on every report.
   g_tz_offset = (long)TimeTradeServer() - (long)TimeGMT();

   double closed_net = 0.0;
   string deals = BuildDeals(closed_net);
   string positions = BuildPositions();

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double initial = InpInitialDeposit > 0 ? InpInitialDeposit : (balance - closed_net);

   string acc = "{";
   acc += L("login", AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   acc += Q("name", AccountInfoString(ACCOUNT_NAME)) + ",";
   acc += Q("server", AccountInfoString(ACCOUNT_SERVER)) + ",";
   acc += Q("company", AccountInfoString(ACCOUNT_COMPANY)) + ",";
   acc += Q("currency", AccountInfoString(ACCOUNT_CURRENCY)) + ",";
   acc += L("leverage", AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   acc += N("balance", balance, 2) + ",";
   acc += N("equity", AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   acc += N("credit", AccountInfoDouble(ACCOUNT_CREDIT), 2) + ",";
   acc += N("margin", AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   acc += N("freeMargin", AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   acc += N("marginLevel", AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ",";
   acc += N("initialDeposit", initial, 2) + ",";
   // Dashboard counts the trading day on this clock (server midnight = 17:00 New York).
   acc += L("tzOffsetMin", g_tz_offset / 60);
   acc += "}";

   string json = "{";
   json += L("updatedAt", ToUtc(TimeCurrent())) + ",";
   json += L("tzOffsetMin", g_tz_offset / 60) + ",";
   json += "\"account\":" + acc + ",";
   json += "\"positions\":" + positions + ",";
   json += "\"deals\":" + deals;
   json += "}";
   return json;
}

//+------------------------------------------------------------------+
void SendReport()
{
   string json = BuildJson();

   string headers = "Content-Type: application/json\r\n";
   if(InpToken != "") headers += "X-Auth-Token: " + InpToken + "\r\n";

   char post[], result[];
   string result_headers;
   int len = StringToCharArray(json, post, 0, StringLen(json), CP_UTF8);
   if(len > 0) ArrayResize(post, len);

   ResetLastError();
   int code = WebRequest("POST", InpUrl, headers, 10000, post, result, result_headers);

   if(code == -1)
   {
      int err = GetLastError();
      Print("[Dashboard] WebRequest ล้มเหลว error=", err,
            (err == 4014 ? "  -> ยังไม่ได้ใส่ URL ใน Tools>Options>Expert Advisors" : ""));
      return;
   }
   if(InpVerbose)
      Print("[Dashboard] HTTP ", code, " size=", ArraySize(post), " bytes  ",
            CharArrayToString(result, 0, MathMin(200, ArraySize(result))));
}
//+------------------------------------------------------------------+
