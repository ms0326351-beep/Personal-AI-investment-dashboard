# 個人投資情報 Dashboard — Implementation Plan

> 本文件由 Claude（設計/審查代理）撰寫，作為 Codex（實作代理）的第一版開發規格。
> 版本：v1（MVP，mock data）
> 語言：介面全繁體中文；程式碼註解與變數命名使用英文。

---

## 0. 專案目標與範圍

個人使用的投資資訊 Dashboard，聚焦台股、美股、ETF（目前重點：0050、美股 ETF）。

**第一版明確排除**：登入/帳號系統、金流/付款、自動下單、真實市場資料串接、真實 AI 串接。
**第一版必須做到**：完整可用的 UI/UX、完整的 mock data、可運作的投資組合輸入與自動計算、Watchlist、個股研究頁，且架構要讓後續串接「真實市場 API」「GPT API」「每日摘要/通知」時，只需替換 service 實作，不需重寫 UI。

---

## 1. 專案架構

採用 **Next.js（App Router）+ TypeScript + Tailwind CSS**，分層原則：UI 元件、資料模型（types）、資料服務（services，含 mock 與未來 real 實作）、mock 資料本身四層彼此獨立，UI 永遠只依賴 service 的介面（interface），不直接依賴 mock 或未來的 API SDK。

```
investment-dashboard/
├── app/                          # Next.js App Router 頁面
│   ├── layout.tsx                # 全站 Layout（含側邊欄/頂部導覽、RWD 容器）
│   ├── page.tsx                  # "/" -> redirect 到 /dashboard
│   ├── dashboard/
│   │   └── page.tsx              # 首頁 Dashboard
│   ├── portfolio/
│   │   └── page.tsx              # 投資組合頁
│   ├── watchlist/
│   │   └── page.tsx              # 觀察清單頁
│   ├── stock/
│   │   └── [symbol]/
│   │       └── page.tsx          # 個股/ETF 詳細研究頁（動態路由）
│   └── globals.css
│
├── components/
│   ├── layout/
│   │   ├── SidebarNav.tsx        # 桌機側邊導覽
│   │   ├── TopBar.tsx            # 頂部列（標題、更新時間、手機漢堡選單）
│   │   └── MobileNav.tsx         # 手機底部/抽屜導覽
│   ├── dashboard/
│   │   ├── MarketIndexStrip.tsx  # 大盤指數列（台股/美股今日漲跌）
│   │   ├── MarketCommentaryCard.tsx # 「為什麼今天漲/跌」摘要卡
│   │   ├── MarketNewsFeed.tsx    # 重要市場新聞列表
│   │   ├── EventWatchList.tsx    # 值得注意的事件（財報、Fed 會議、除息…）
│   │   ├── PortfolioSummaryCard.tsx # 總市值/總損益/報酬率總覽
│   │   ├── AssetAllocationChart.tsx # 資產配置圓餅圖
│   │   └── WatchlistPreviewCard.tsx # Dashboard 上的 Watchlist 精簡預覽
│   ├── portfolio/
│   │   ├── HoldingsTable.tsx     # 持股列表（含自動計算欄位）
│   │   ├── HoldingFormDialog.tsx # 新增/編輯持股表單
│   │   └── HoldingRowActions.tsx # 編輯/刪除操作
│   ├── watchlist/
│   │   ├── WatchlistTable.tsx
│   │   └── AddToWatchlistDialog.tsx
│   ├── stock/
│   │   ├── StockHeader.tsx       # 名稱/代號/現價/漲跌幅
│   │   ├── PriceChart.tsx        # 價格走勢圖（含區間切換 1D/1M/1Y）
│   │   ├── FundamentalsPanel.tsx # 基本資料（產業、市值、殖利率等）
│   │   ├── StockNewsPanel.tsx    # 個股相關新聞
│   │   ├── AISummaryPanel.tsx    # AI 摘要
│   │   ├── BullBearFactors.tsx   # 多空因素（正/反兩欄）
│   │   └── RiskAlertPanel.tsx    # 風險提醒
│   └── ui/                       # 通用基礎元件（Button, Card, Badge, Table, Tabs, Dialog…）
│
├── lib/
│   ├── types/
│   │   ├── market.ts             # MarketIndex, Quote
│   │   ├── security.ts           # Security（股票/ETF 基本定義）
│   │   ├── portfolio.ts          # Holding, PortfolioMetrics
│   │   ├── watchlist.ts          # WatchlistItem
│   │   ├── news.ts               # NewsItem
│   │   └── ai.ts                 # AIAnalysis, MarketCommentary
│   ├── services/                 # 【重要】UI 只呼叫這一層的介面
│   │   ├── marketDataService.ts  # interface + mock 實作（未來換成真實 API 實作）
│   │   ├── newsService.ts        # interface + mock 實作
│   │   ├── aiAnalysisService.ts  # interface + mock 實作（未來換 GPT API）
│   │   ├── portfolioRepository.ts# CRUD，第一版用 localStorage 實作
│   │   └── watchlistRepository.ts# CRUD，第一版用 localStorage 實作
│   ├── mock/
│   │   ├── mockIndices.ts
│   │   ├── mockSecurities.ts
│   │   ├── mockNews.ts
│   │   ├── mockAIAnalysis.ts
│   │   └── mockHoldings.ts       # 預設種子資料（0050 等），首次載入時寫入 localStorage
│   ├── calculations/
│   │   └── portfolioMath.ts      # 總成本/市值/損益/報酬率/配置比例 計算純函式
│   └── utils/
│       ├── formatters.ts         # 貨幣、百分比、日期（zh-TW）格式化
│       └── constants.ts          # 市場代碼、幣別、路由常數
│
├── hooks/
│   ├── usePortfolio.ts           # 讀寫 portfolioRepository + 即時計算
│   ├── useWatchlist.ts
│   └── useMarketData.ts
│
├── DESIGN.md                     # （後續視覺設計調整時使用，依 CLAUDE.md 流程）
├── REVIEW.md                     # （Claude Review 後產出）
├── .env.example                  # 預留 MARKET_API_KEY / OPENAI_API_KEY 等
└── implementation-plan.md        # 本文件
```

**分層規則（務必遵守）**：
- Components 不得直接 import `lib/mock/*`，一律透過 `lib/services/*` 取得資料。
- `services` 內每個檔案都先定義 TypeScript `interface`，再 export 一個 mock 實作（例如 `mockMarketDataService: MarketDataService`）。未來要接真實 API，只需新增 `realMarketDataService.ts` 實作同一介面並替換注入點，UI 完全不用改。
- 金額計算（成本、市值、損益、報酬率、配置比例）全部集中在 `lib/calculations/portfolioMath.ts`，純函式、可單元測試，不散落在元件裡。

---

## 2. 頁面架構

| 路由 | 頁面 | 說明 |
|---|---|---|
| `/dashboard` | 首頁（預設首頁，`/` 導向此處） | 每日快速掃描：大盤、新聞、漲跌原因、事件、投組總覽、資產配置、Watchlist 預覽 |
| `/portfolio` | 投資組合 | 持股輸入、列表、自動計算、新增/編輯/刪除 |
| `/watchlist` | 觀察清單 | 關注中但未持有的標的 |
| `/stock/[symbol]` | 個股/ETF 詳細研究頁 | 價格走勢、基本資料、新聞、AI 摘要、多空因素、風險提醒 |

**導覽**：桌機左側固定 Sidebar（Dashboard／投資組合／觀察清單），手機改為頂部漢堡選單 + 抽屜或底部導覽列（4 個以內項目適合底部 Tab Bar，此處建議用底部 Tab Bar：首頁/投組/觀察/設定，「設定」先做 placeholder）。

---

## 3. Dashboard 各區塊設計

由上到下，依「每天快速掌握」的資訊優先序排列：

### 3.1 市場指數列（MarketIndexStrip）
- 橫向卡片（手機可橫向滑動），顯示：加權指數、櫃買指數、S&P 500、Nasdaq、道瓊。
- 每卡顯示：指數名稱、點數、漲跌點數、漲跌幅（%），漲用紅、跌用綠（**依台灣習慣**：紅漲綠跌，需在 DESIGN.md 中明確定義色彩規則，並在美股資料上也統一套用此規則以求一致，而非中英混用美式配色）。
- 卡片右上角顯示資料更新時間（mock 階段可用固定假時間，並標註「模擬資料」）。

### 3.2 今日重點摘要卡（MarketCommentaryCard）
- 對應需求「為什麼今天漲或跌」。
- 結構：一句話結論（如：「台股受美股科技股走弱拖累，早盤下跌後尾盤收斂跌幅」）+ 3 條條列原因。
- 資料來源：`aiAnalysisService.getMarketCommentary()`，第一版回傳 mock 文字，未來換成 GPT API 產出的每日摘要。
- 需明確標示「AI 生成內容，僅供參考，非投資建議」的小字免責聲明。

### 3.3 重要市場新聞（MarketNewsFeed）
- 列表卡，每則：標題、來源、發布時間（相對時間，如「3 小時前」）、1 行摘要、相關標的 tag（如 `0050`, `AAPL`）。
- 預設顯示 5-8 則，提供「查看更多」（可先連到一個簡單的新聞列表頁或先做 disabled/敬請期待）。

### 3.4 值得注意的事件（EventWatchList）
- 對應「有哪些值得注意的事件」，例如：美國 CPI 公布、Fed 利率會議、0050 除息日、重點持股財報日。
- 呈現為時間軸/清單：日期、事件名稱、重要度標籤（高/中/低）、相關市場（台股/美股）。

### 3.5 投資組合總覽（PortfolioSummaryCard）
- 4 個關鍵指標卡：總市值、總成本、未實現損益（金額＋%，正負用紅綠區分）、今日投組漲跌。
- 若尚無任何持股，顯示 Empty State，引導使用者前往 `/portfolio` 新增。

### 3.6 資產配置圖（AssetAllocationChart）
- 圓餅圖／環狀圖，依「市場別（台股/美股）」與「類型（個股/ETF）」兩種切換 tab 呈現配置比例。
- 圖表下方列出圖例＋百分比數字（避免只靠顏色辨識，兼顧色盲使用者的可讀性）。

### 3.7 觀察清單預覽（WatchlistPreviewCard）
- 顯示 Watchlist 前 5 檔的代號、現價、漲跌幅，並提供「查看全部」連到 `/watchlist`。

**RWD 原則**：桌機採 12 欄 grid，3.1/3.5 兩區塊全寬，3.2/3.3/3.4 三欄並排，3.6/3.7 兩欄並排；手機（<768px）全部改為單欄垂直堆疊，卡片內部間距縮小，圖表改用較低高度並保留可水平滑動的表格。

---

## 4. 資料模型（TypeScript Interfaces）

```ts
// lib/types/market.ts
export type MarketCode = 'TW' | 'US';

export interface MarketIndex {
  code: string;              // 'TAIEX' | 'SP500' | 'NASDAQ' | ...
  name: string;               // '加權指數'
  market: MarketCode;
  value: number;
  change: number;
  changePercent: number;
  updatedAt: string;          // ISO datetime
}

// lib/types/security.ts
export type SecurityType = 'stock' | 'etf';
export type Currency = 'TWD' | 'USD';

export interface Security {
  symbol: string;              // '0050' | 'AAPL'
  name: string;                // '元大台灣50'
  market: MarketCode;
  type: SecurityType;
  currency: Currency;
  price: number;
  change: number;
  changePercent: number;
  sector?: string;
  marketCap?: number;
  dividendYield?: number;
  updatedAt: string;
}

// lib/types/portfolio.ts
export interface Holding {
  id: string;                  // uuid
  symbol: string;               // 對應 Security.symbol
  shares: number;
  avgCost: number;              // 每股平均成本（以該標的原幣別計）
  buyDate: string;               // ISO date
  note?: string;
}

// 由 Holding + Security 計算得出，不落地儲存
export interface PortfolioMetrics {
  symbol: string;
  currentPrice: number;
  totalCost: number;
  marketValue: number;
  unrealizedPL: number;
  returnRate: number;           // %
  weightPercent: number;        // 在整體投組中的配置比例
}

// lib/types/watchlist.ts
export interface WatchlistItem {
  symbol: string;
  addedAt: string;
  note?: string;
}

// lib/types/news.ts
export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt: string;
  relatedSymbols: string[];
}

// lib/types/ai.ts
export interface MarketCommentary {
  date: string;
  headline: string;
  reasons: string[];
  disclaimer: string;
}

export interface AIAnalysis {
  symbol: string;
  summary: string;
  bullFactors: string[];
  bearFactors: string[];
  riskAlerts: string[];
  generatedAt: string;
  disclaimer: string;
}
```

**幣別處理**：投組總覽以「原幣別分別加總 + 換算成台幣後合計」兩種方式呈現，換算匯率第一版用 mock 固定匯率（`lib/mock/mockFx.ts`），未來由真實匯率 API 取代，UI 不需更動。

---

## 5. 建議技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 框架 | Next.js 14+（App Router）＋ TypeScript | SSR/CSR 彈性佳，未來要加 API Route（GPT/市場資料代理）也方便 |
| 樣式 | Tailwind CSS | 開發快、RWD 好寫，與「簡潔現代」的金融 Dashboard 風格契合 |
| UI 元件庫 | shadcn/ui（基於 Radix） | 提供 Table/Dialog/Tabs 等無障礙元件，可自訂樣式而非套用制式主題 |
| 圖表 | Recharts | 輕量、API 直覺，滿足走勢圖與圓餅圖需求；不需要 K 線功能，暫不用 lightweight-charts |
| 狀態管理 | React 內建 state + Context／輕量 Zustand（僅 portfolio、watchlist 需跨頁共享時使用） | 資料量小，不需要 Redux 等重型方案 |
| 本地持久化 | `localStorage`（透過 repository 封裝） | 第一版無登入無後端，需求 12 明確排除登入，但持股資料要能保留 |
| 圖示 | lucide-react | 與 shadcn/ui 搭配良好 |
| 日期處理 | date-fns | 輕量、tree-shakable |
| 型別/資料驗證 | zod（可選，用於 service 邊界資料驗證，方便未來接真實 API 時抓格式錯誤） |
| 測試 | Vitest + React Testing Library（至少覆蓋 `portfolioMath.ts` 計算邏輯） |

---

## 6. 第一版 MVP 與後續版本功能切分

### v1（MVP，本次實作範圍）
- 全站 mock data，涵蓋所有 8 大功能區塊的完整 UI。
- 投資組合 CRUD（localStorage 持久化）＋ 自動計算（現價、成本、市值、損益、報酬率、配置比例）。
- Watchlist CRUD（localStorage）。
- 個股詳細頁完整版型（含 AI 摘要/多空因素/風險提醒 UI，內容為 mock）。
- RWD（桌機／手機），繁體中文介面。
- Service 層介面已定義好，方便 v2 起替換實作。

### v2（真實市場資料）
- 接入台股資料源（如證交所 OpenAPI／第三方）與美股資料源（如 Finnhub、Alpha Vantage、Yahoo Finance）。
- 新增 Next.js API Route 作為代理層，隱藏 API Key，處理 CORS 與快取（避免前端直接曝露金鑰）。
- 價格輪詢/快取策略（例如每 60-300 秒更新一次，非即時逐筆）。
- 加入資料來源與「最後更新時間」的明確標示，處理非交易時段的資料狀態。

### v3（真實 AI 分析）
- 獨立 `AI Analysis Service`（可先做成 Next.js API Route，未來可拆成獨立後端服務）。
- 串接 GPT API，輸入當日行情＋新聞，產出：市場摘要、個股 AI 摘要、多空因素、風險提醒。
- 加入結果快取（同一標的同一天只呼叫一次 API，避免重複花費）。
- 明確、顯眼的免責聲明常駐。

### v4（每日摘要與通知、雛形帳號）
- 每日排程（cron / serverless scheduled function）產生每日摘要。
- 通知管道：Email 或瀏覽器推播。
- 視需求評估是否要輕量帳號系統（僅為了跨裝置同步 portfolio，而非商業化付費系統）。

> **登入/付款/自動下單**：依需求 12，本階段（v1-v4）皆不規劃，待未來有明確需求時另行設計。

---

## 7. Codex 實作順序（建議 Step-by-Step）

1. **專案初始化**：`create-next-app`（TypeScript、Tailwind、App Router）、安裝 shadcn/ui、lucide-react、recharts、date-fns、zod。
2. **建立資料夾骨架**：依第 1 節結構建立 `app/`、`components/`、`lib/`、`hooks/` 空目錄與檔案。
3. **定義型別**：完成 `lib/types/*.ts`（第 4 節內容）。
4. **建立 mock 資料**：`lib/mock/*`，至少涵蓋 0050、2-3 檔台股、3-5 檔美股/美股 ETF、5-8 則新聞、2-3 個事件、對應的 AI 分析範例文字。
5. **建立 service 層**：先寫 interface，再寫 mock 實作；`portfolioRepository`／`watchlistRepository` 用 localStorage 實作（含 SSR 安全處理，避免 `window is not defined`）。
6. **計算邏輯**：`lib/calculations/portfolioMath.ts` + 對應單元測試。
7. **全站 Layout**：`app/layout.tsx`、`SidebarNav`、`TopBar`、`MobileNav`，先把 RWD 導覽骨架做出來。
8. **Dashboard 頁**：依 3.1 → 3.7 順序逐區塊實作並串 mock service。
9. **Portfolio 頁**：列表 → 新增表單 → 編輯/刪除 → 驗證輸入（股數/成本需為正數，日期需合法）。
10. **Watchlist 頁**：列表 → 新增/移除。
11. **個股詳細頁** `/stock/[symbol]`：Header → PriceChart → Fundamentals → News → AISummary → BullBear → RiskAlert；找不到 symbol 時顯示 404 型 Empty State。
12. **RWD 與無障礙審查**：斷點測試（375/768/1024/1440）、色彩對比、鍵盤可操作性、圖表的文字替代說明。
13. **Loading／Empty／Error 狀態**補齊所有非同步區塊。
14. 完成後交由 Claude 進行 Review，產出 `REVIEW.md`。

---

## 8. 可能遇到的問題

- **紅漲綠跌 vs 美股慣例**：台股習慣紅漲綠跌，國際/美股慣例常是綠漲紅跌，混合呈現容易造成使用者誤判。**決議**：全站統一採台灣使用者直覺的「紅漲綠跌」，需在 DESIGN.md 中明訂，避免 Codex 依國際慣例反著做。
- **股票代號格式不一致**：台股（`0050`）、美股（`AAPL`）、部分資料源可能用 `0050.TW`。需在 `Security.symbol` 訂出內部統一格式，並在未來 v2 串接真實 API 時建立 normalize 對照層。
- **幣別混合計算**：投組同時有 TWD 與 USD 資產時，總市值/總損益需先決定是否換算成單一幣別呈現，v1 先用固定 mock 匯率並明確標示「匯率為模擬值」。
- **localStorage 的限制**：資料只存在單一瀏覽器，換裝置或清除瀏覽器資料會遺失，需在投組頁面加入提示文字，並考慮提供「匯出/匯入 JSON」功能作為 v1 的簡易備援（可列入 v1 加分項或 v2 早期項目）。
- **非交易時間的資料狀態**：mock 階段不明顯，但 v2 串真實 API 後，需處理「盤後」「盤前」「休市」時漲跌數字如何顯示（例如標示「收盤價」而非誤導成即時價）。
- **AI 內容的可信度與免責**：AI 摘要/多空因素屬於生成內容，需要在 UI 上有一致且明顯的「非投資建議」標示，並避免使用過度肯定的語氣（如「必漲」「保證」等字眼），這點在 mock 文案階段就應該養成習慣。
- **圖表在手機上的可用性**：Recharts 在小螢幕上 tooltip 與觸控互動需要特別測試，避免圖表過擠或文字重疊。
- **未來 API 金鑰安全性**：GPT API 與市場資料 API 的金鑰絕不可曝露在前端（`NEXT_PUBLIC_*`），必須透過 Next.js API Route／伺服器端呼叫，這在 v1 建立 `.env.example` 與 service 層介面時就要預留正確的呼叫位置（server-only）。
- **每日摘要的呼叫成本**：v3 若對每個持股/觀察清單標的都即時呼叫 GPT API，成本會隨標的數量增加，需設計「每日僅生成一次＋快取」機制，而非每次載入頁面都重新呼叫。

---

## 附錄：後續串接的預留設計說明

- `lib/services/marketDataService.ts`、`newsService.ts`、`aiAnalysisService.ts` 皆先定義 interface，mock 實作與未來 real 實作（如 `realMarketDataService.ts`）互相替換即可，不影響任何 UI 元件。
- `.env.example` 預留：
  ```
  MARKET_DATA_API_KEY=
  MARKET_DATA_API_BASE_URL=
  OPENAI_API_KEY=
  ```
- 未來新增每日摘要／通知功能時，建議新增 `app/api/daily-summary/route.ts`（Next.js API Route）作為排程觸發的進入點，內部呼叫 `aiAnalysisService`，與現有頁面邏輯解耦。
