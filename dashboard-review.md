# Dashboard Review — 「誰在影響市場」模組評估與設計

> 撰寫者：Claude（設計/審查代理）
> 審查對象：`http://localhost:3000/dashboard`（目前線上版本，對應 `app/dashboard/page.tsx` 等現有實作）
> 對照文件：`implementation-plan.md`（v1 原始規格）、`DESIGN.md`（視覺實作紀錄）
> 性質：本文件為**審查＋新模組設計規格**，供 Codex 下一階段實作依據。**本次未直接修改任何 production 程式碼。**

---

## 總結：目前 Dashboard 的核心落差

目前實作完整還原了 `implementation-plan.md` v1 的規格：指數、投組總覽、資產配置、新聞列表、事件列表、AI 市場摘要、個股研究頁。**UI 執行品質不錯**（RWD、色彩規則、可及性都有落實），但如你所述，這個版本本質上是「數據 + 靜態新聞列表」的組合，**沒有回答「誰」在影響市場**。

具體來說，現況資料模型裡完全沒有「人物/機構」這個實體（`lib/types/index.ts` 沒有對應 type），新聞（`NewsItem`）與事件（`MarketEvent`）也沒有欄位指向任何人物或因果鏈，因此 A～D 四項你要的模組**無法用現有資料結構表達**，必須新增型別、mock 資料、頁面與元件。以下依你列出的 10 項工作逐一處理。

---

## 1. 現況檢查：哪些資訊不重要或重複

| 位置 | 問題 | 嚴重度 |
|---|---|---|
| Dashboard「0050 焦點」卡（`app/dashboard/page.tsx` 內的 `etf-card`） | 0050 已經是投組中最大部位，且會出現在「我的投資組合」與（若加入）Watchlist 中，這張卡只是重複顯示現價與漲跌幅，沒有提供新資訊。 | Important — 建議騰出這個版位給「今日關鍵人物」或「因果鏈焦點」，資訊密度會更高。 |
| 「今日 AI 市場摘要」的 3 條 reasons vs 「重要市場新聞」5 則新聞 | 兩區塊講的幾乎是同一件事（「半導體／科技股走強」），且都沒有點名是誰的發言或政策造成的，讀起來像同一份稿子拆成兩份。 | Important — 這正是你說的「新聞只是新聞」問題：兩區塊都缺「誰」這個歸因層，應該合併資訊來源、並讓摘要明確指向關鍵人物/事件。 |
| 「值得注意的事件」卡 | 只有日期＋標題＋市場＋重要度（高/中/低），沒有時間點、沒有連結到人物，也不分「今天」vs「未來幾週」。使用者無法一眼判斷「今天幾點會有波動」。 | Critical（對應你的需求 D）— 需要拆成「今日事件時間軸」（今天，含時間點）與「近期重大事件」（未來數週，可留在既有卡片精簡呈現）兩種資料，不應混在一起。 |
| 指數列（全球市場）與投組總覽的「今日投組漲跌」 | 不算重複，但兩者目前互相獨立，沒有任何文字連結「大盤為什麼漲」跟「我的投組為什麼漲」。 | Minor — 屬於 2、3 節要補的「因果鏈」與「個人化」範疇，非刪減問題。 |
| `app/dashboard/page.tsx`、`app/stock/[symbol]/page.tsx` 等頁面幾乎整頁寫成單行 JSX，沒有拆成本來規劃的 `components/dashboard/*`、`components/stock/*` 子元件 | 不是本次審查的重點（你要求先看資訊架構），但會讓下一階段新增模組時難以維護、難以 code review。 | Minor（品質債，建議在下一輪順手拆分，不必獨立處理） |

**結論**：現有資訊沒有「該刪除」的內容，問題不是太多而是太淺——都停在「發生了什麼」，沒有到「誰造成的、會影響哪些標的、跟我有沒有關係」。

---

## 2. 應該新增的資訊（資料層級）

對應你的 A～E，新增以下資訊類別，且彼此要能互相關聯（這是本次設計的核心）：

1. **關鍵人物 / 機構**（`KeyPerson`）：姓名、職位、機構、分類、目前影響程度。
2. **人物事件**（`PersonEvent`）：某人物在某時間點的發言/行動，含 AI 判斷的方向（利多/利空/中性）、影響市場、受影響標的、影響程度。
3. **因果鏈**（`CausalChain`）：把「人物事件 → 受影響產業 → 受影響市場 → 受影響標的」串成一條可視化的鏈。
4. **今日時間軸**（`DayTimelineEntry`）：今天當天、依時間排序的事件排程（開盤、記者會、數據公布、財報），可選連結到人物與標的。
5. **新聞與人物/事件的關聯**：`NewsItem` 需新增 `relatedPersonIds`，讓新聞能回頭連到是誰造成的。
6. **個人化關聯旗標**：不是新的資料表，而是一個**跨模組的計算邏輯**——任何人物、事件、新聞只要 `affectedSymbols` 或 `relatedSymbols` 命中使用者的 `Holding.symbol` 或 `WatchlistItem.symbol`，就標示「與你相關」並提高排序優先度。

---

## 3. 首頁資訊層級重新設計

你提出的順序（一句話 → 事件 → 人物 → 持股 → 數據 → AI解讀 → 新聞）方向是對的：**先給結論與歸因，再給數字，最後給佐證新聞**，這符合「每天快速掌握」的目標，比現況「先丟一排數字」更好。我的調整只有兩點，其餘照你的順序：

- **把「今日關鍵人物」與「今日事件時間軸」視為同一組「誰在影響市場」資訊，緊鄰擺放**（人物在事件之前或之後都可以，但中間不要被數據卡片打斷），因為兩者本來就是因果鏈的兩端。
- **「個人化關注」不獨立成一個區塊，而是貫穿在人物卡、事件時間軸、新聞的排序與標記邏輯裡**（見第 2 節第 6 點），「我的持股/Watchlist」仍保留成一個獨立區塊，但它不是唯一體現個人化的地方——這樣即使使用者略過持股區塊，也會在人物卡上直接看到「與你的 0050／台積電相關」的標記，符合你「優先顯示」的要求。

**最終建議的首頁順序**：

1. **今日市場一句話**（取代現有 headline，但文案必須明確點名驅動者，例如「Fed 官員鷹派發言壓抑美股科技股，台積電同步走弱」而非「科技股領軍」這種無主詞的說法）
2. **今日關鍵人物**（3–5 人，卡片依「與我相關」優先排序，見第 4、5 節）
3. **今日重要事件時間軸**（今天，含現在時間指示線，見第 7 節）
4. **因果鏈焦點卡**（今天最重要的 1 組因果鏈，橫向步驟可視化，見第 6 節附圖說明）
5. **我的持股 / Watchlist**（沿用現有投組總覽＋資產配置，但每筆持股若命中今日人物/事件，加上小紅點或「今日相關」badge）
6. **重要市場數據**（現有的全球市場指數列，從第一區降到這裡）
7. **AI 市場解讀**（現有的較長篇 AI 摘要，作為深入版本，與第 1 項的一句話結論互補而非重複）
8. **新聞**（改為佐證資料：每則新聞若有對應人物，顯示人物頭像/姓名 tag，讓使用者知道這則新聞屬於哪條因果鏈）

---

## 4. 「關鍵人物」頁面設計（`/people`）

### 路由與導覽
新增路由 `app/people/page.tsx`，側邊導覽（`components/layout/Navigation.tsx`）在「市場總覽」與「我的投資組合」之間插入「關鍵人物」（icon 建議用 `Users` from lucide-react）。

### 版面
- 頁首：標題「關鍵人物」＋副標「追蹤正在影響台股與美股的人物與機構」。
- 篩選列（可橫向捲動的 chips，比照現有指數列的手機捲動模式）：全部／美國政治與政府／Fed／台灣政治與監理／企業領袖／與我相關。
- 排序：預設「與我相關優先，其次影響程度」，可切換「最新更新」。
- 主體：卡片 grid（桌機 3 欄、平板 2 欄、手機 1 欄），沿用現有 `Card` 元件風格（白卡、圓角、陰影同 `components/ui/common.tsx` 既有樣式）。

### 人物卡片內容（對應你列的必要欄位）
```
┌───────────────────────────────┐
│ [頭像/縮寫圈]  姓名                │  ← 姓名＋職位/機構（如「Jerome Powell · Fed 主席」）
│              職位 · 機構            │
│ [與我相關] [影響程度：高]            │  ← badge，命中投組/Watchlist 才顯示「與我相關」
│                                    │
│ 最近事件：一句話摘要                 │  ← PersonEvent.headline
│ 2026/09/10 14:00                  │  ← 事件時間
│                                    │
│ 影響方向：▲ 利多   可能影響：半導體/美股 │ ← ImpactDirection + AffectedMarket tags
│ 受影響標的：NVDA  AAPL  2330  0050  │ ← 命中投組的標的加粗或加底色
│                                    │
│              查看時間線與新聞 →       │
└───────────────────────────────┘
```
- 影響方向沿用全站既有紅漲綠跌配色：利多＝紅、利空＝綠、中性＝灰（與現有 `Change` 元件邏輯一致，避免使用者需要學新的顏色語言）。
- 影響程度（高/中/低）用小圓點＋文字，不要只靠顏色。
- 卡片整張可點擊進入 `/people/[id]`。

### Empty / 資料時效標示
比照現有全站慣例，卡片與頁首都要有「模擬資料」「資料時間」標示，避免使用者誤以為是即時真實內容。

---

## 5. 人物詳細頁設計（`/people/[id]`）

### 版面骨架（比照現有 `/stock/[symbol]` 的 detail-grid 慣例，維持風格一致）
1. **頁首**：← 返回關鍵人物、頭像、姓名、職位/機構、分類 tag、目前影響程度 badge。
2. **關聯標的面板**（右側或次要卡）：列出 `relatedSymbols`，命中投組/Watchlist 的標的加上「你持有」/「你的觀察清單」小標籤，點擊可跳轉到 `/stock/[symbol]`。
3. **最近事件時間線**（主欄，垂直時間線 UI）：由新到舊列出該人物的 `PersonEvent`，每筆顯示時間、一句話描述、影響方向 badge、受影響標的 tags、來源新聞連結。
4. **今日因果鏈**（若該人物今天有事件才顯示）：使用第 6 節的因果鏈元件，呈現「此人發言 → 受影響產業 → 受影響市場 → 受影響標的」。
5. **相關新聞**：沿用現有 `NewsList` 元件，資料改為 `newsService.getNews()` 依 `relatedPersonIds` 過濾。
6. **AI 綜合觀點區塊**：比照個股頁的「AI 研究摘要」樣式，但內容聚焦在「這個人物近期對市場的整體傾向」，並保留與全站一致的免責聲明樣式。

### 找不到人物時
比照現有 `notFound()` 慣例（`app/stock/[symbol]/page.tsx` 已有前例），`/people/[id]` 查無資料時導向現有 `app/not-found.tsx`。

---

## 6. 人物與股票/ETF 關聯資料模型

新增檔案 `lib/types/people.ts`（獨立檔案，維持現有 `lib/types` 一檔一領域的慣例，但目前專案是單一 `index.ts`，建議此次順手依領域拆分，Codex 可自行決定是否連同既有 type 一併拆分或先併入 `index.ts`，不強制）：

```ts
export type ImpactDirection = 'bullish' | 'bearish' | 'neutral';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type AffectedMarket = 'TW' | 'US' | 'semiconductor' | 'ai' | 'financial' | 'fx' | 'bond';
export type PersonCategory = 'us_politics' | 'central_bank' | 'tw_politics' | 'regulator' | 'corporate_leader';

export interface KeyPerson {
  id: string;                    // 'jerome-powell'
  name: string;                  // '鮑爾'
  nameEn?: string;                // 'Jerome Powell'
  title: string;                  // 'Fed 主席'
  organization: string;            // '美國聯準會'
  category: PersonCategory;
  country: 'US' | 'TW' | 'other';
  avatarUrl?: string;              // v1 先用姓名縮寫圈，不強求真實頭像
  currentImpactLevel: ImpactLevel; // 依最新一筆 PersonEvent 帶出，非獨立維護
  relatedSymbols: string[];        // 長期關聯標的（不限今天），如 Powell -> 大盤 ETF、金融股
}

export interface PersonEvent {
  id: string;
  personId: string;                // 對應 KeyPerson.id
  occurredAt: string;               // ISO datetime
  headline: string;                 // 一句話摘要，卡片用
  description: string;              // 詳細說明，詳細頁用
  impactDirection: ImpactDirection;
  impactLevel: ImpactLevel;
  affectedMarkets: AffectedMarket[];
  affectedSymbols: string[];        // 本次事件實際受影響標的（relatedSymbols 的子集或延伸）
  relatedNewsIds: string[];         // 對應 NewsItem.id
}

export interface CausalChainStep {
  order: number;
  label: string;                    // '川普宣布半導體關稅政策'
  type: 'person_action' | 'sector_impact' | 'market_impact' | 'symbol_impact';
  refId?: string;                    // personId / sector 代碼 / symbol，供點擊跳轉
}

export interface CausalChain {
  id: string;
  title: string;                     // 因果鏈標題，卡片用
  date: string;
  steps: CausalChainStep[];           // 依序呈現，UI 用箭頭串接
  relatedPersonIds: string[];
  relatedSymbols: string[];
}
```

**既有型別需要的異動**（`lib/types/index.ts`）：
```ts
export interface NewsItem {
  // ...既有欄位不變
  relatedPersonIds?: string[];   // 新增，選填，向後相容既有 mock 新聞
}

export interface DayTimelineEntry {
  time: string;                   // '09:00' 24 小時制
  label: string;                  // '台灣開盤'
  category: 'market_open' | 'economic_data' | 'fed_speech' | 'earnings' | 'policy' | 'other';
  markets: AffectedMarket[];
  importance: ImpactLevel;
  relatedPersonIds?: string[];
  relatedSymbols?: string[];
}
```

**Service 層**（延續現有分層原則，UI 只依賴 interface）：
- `lib/services/peopleService.ts`：定義 `PeopleService { getPeople(): Promise<KeyPerson[]>; getPerson(id): Promise<KeyPerson|null>; getPersonEvents(personId): Promise<PersonEvent[]>; getTodayHighlightPeople(): Promise<KeyPerson[]>; }`，mock 實作放 `lib/mock/people.ts`。
- `lib/services/causalChainService.ts`：`{ getTodayChains(): Promise<CausalChain[]> }`。
- `newsService` 擴充 `getEvents()` 改為回傳 `DayTimelineEntry[]`（見第 7 節，屬於 breaking change，需同步更新現有 `MarketEvent` 使用處）或新增 `getDayTimeline()` 保留原 `getEvents()` 相容——**建議新增獨立方法而非改既有介面**，降低對現有頁面的破壞性。
- **個人化比對邏輯**集中寫成一個共用工具函式 `lib/utils/relevance.ts`：`isRelevantToUser(symbols: string[], holdings: Holding[], watchlist: string[]): boolean`，人物卡、事件卡、新聞卡都呼叫同一函式，避免邏輯分散、日後行為不一致。

---

## 7. 事件時間線設計（今日時間軸，Dashboard 用）

這是你需求 D 的核心，且要跟人物頁的「歷史事件列表」區分開來——**時間軸是「今天的時鐘」，人物頁時間線是「這個人的歷史記錄」**，資料結構也不同（`DayTimelineEntry` vs `PersonEvent`）。

### 元件：`components/dashboard/DayTimeline.tsx`
- 垂直時間軸，左側時間刻度（比照你範例：09:00 台灣開盤／14:00 Fed 官員談話／20:30 美國 CPI／22:00 美國重要數據／盤後 NVIDIA 財報）。
- **現在時間指示線**：用一條橫線＋「現在」標籤標示目前時間位置，已過去的項目淡化（灰階降低對比），尚未發生的項目正常顯示，正在進行中/剛發生的項目高亮（例如左側色條）。
- 每個項目：時間、標籤、類別 icon（開盤／經濟數據／Fed談話／財報／政策，用不同 lucide icon 區分）、重要度 badge（高/中/低）、若有 `relatedPersonIds` 顯示人物姓名 chip（可點擊跳轉 `/people/[id]`）、若有 `relatedSymbols` 且命中投組/Watchlist 則顯示「與你相關」小標籤。
- 手機版：改為左側單一時間軸線＋卡片右移，維持可垂直捲動即可，不需要額外做水平捲動（時間軸本質是垂直閱讀，跟指數列的水平捲動不同，不要套用同一套 RWD pattern）。

### 與現有「值得注意的事件」卡的關係
- 現有卡片（`MarketEvent`：日期＋標題＋市場＋重要度）保留，但**限定用途改為「近期重大事件」**（未來數週的財報、除息、會議日期），與「今日事件時間軸」分工：一個看「今天幾點」，一個看「這週還有什麼」。兩者可以在首頁相鄰或收在同一張 Card 的兩個 tab。

---

## 8. 功能優先序：第一版做 vs 延後

### 本次應納入第一版（v1.1，延續 mock data 路線，不需要真的串 GPT/市場 API）

| 項目 | 說明 |
|---|---|
| `KeyPerson` / `PersonEvent` 型別與 mock 資料 | 至少涵蓋你列的名單中 8–12 人：川普、美國總統府/白宮發言人、Fed 主席（Powell）、1–2 位主要 Fed 官員、美國財政部長、Jensen Huang、Tim Cook、Elon Musk、Sam Altman、台灣總統府/行政院發言代表、台灣央行總裁、金管會主委、台積電董事長。Mark Zuckerberg 可列入但先標為「中低影響」，避免名單過度稀釋重點。 |
| `/people` 列表頁＋`/people/[id]` 詳細頁 | 含篩選、排序、與我相關標記。 |
| Dashboard「今日關鍵人物」模組（3–5 人精簡卡） | 直接複用人物卡片的精簡版本。 |
| Dashboard「今日事件時間軸」模組 | 含現在時間指示線，mock 資料涵蓋一個完整交易日的示例排程。 |
| 因果鏈資料模型＋ 1 組視覺化因果鏈元件 | 先做 1 組範例（如你給的川普關稅例子），元件要能重複使用於 dashboard 焦點卡與人物詳細頁。 |
| 個人化關聯比對（`isRelevantToUser`） | 貫穿人物卡、事件時間軸、新聞卡的排序與 badge。 |
| `NewsItem.relatedPersonIds` | 為既有 mock 新聞回填對應人物，讓新聞卡能顯示人物 tag。 |
| 首頁重新排序（第 3 節） | 純版面調整＋新模組插入，不影響既有投組/觀察清單邏輯。 |
| Navigation 新增「關鍵人物」項目 | 桌機側欄＋手機底部導覽（目前手機導覽只有 3 項，需評估是否擴充為 4 項或收在側欄選單，建議收進底部導覽第 4 項，維持一眼可見）。 |

### 建議延後（v2 以後，待真實資料/AI串接時再做）

| 項目 | 延後原因 |
|---|---|
| 由新聞自動萃取人物與事件（NLP/GPT 自動產生 `PersonEvent`） | 需要真實 AI／新聞源，v1 仍是 mock 資料，人工編寫即可示範完整互動與版型。 |
| 影響方向／影響程度由 AI 動態評分 | 同上，且涉及「AI 判斷的可信度」問題，應該等有真實資料時一併設計信心分數與免責機制。 |
| 因果鏈自動生成、多鏈關聯圖（graph view） | 屬於進階視覺化，v1 先驗證「單一因果鏈」元件的可讀性即可，不需要一次做圖網絡。 |
| 人物發言與持股相關時的主動通知/推播 | 依 `implementation-plan.md` v4 規劃，需要通知管道與排程，非本次範圍。 |
| AI 判斷準確度回測（事後驗證多空方向是否應驗） | 進階信任機制，需要真實歷史資料累積後才有意義。 |
| 原始逐字稿/影片來源整合 | 屬於資料來源擴充，非資訊架構問題，延後。 |

---

## 9. 與既有規格文件的關係

本文件**新增並延伸** `implementation-plan.md` 的第 2 節（頁面架構）、第 3 節（Dashboard 區塊設計）、第 4 節（資料模型）：新增 `/people`、`/people/[id]` 兩個路由，新增 `KeyPerson`／`PersonEvent`／`CausalChain`／`DayTimelineEntry` 四個型別，並調整首頁區塊順序與內容。`implementation-plan.md` 原有的 MVP 分版（v1 mock → v2 真實市場資料 → v3 真實 AI → v4 通知）架構維持不變，本文件的「延後」項目對應原規劃的 v2/v3。

Codex 實作本文件內容時，請延續 `implementation-plan.md` 第 1 節訂下的分層原則（UI 只依賴 `lib/services/*` 介面），並比照現有 `marketDataService`／`newsService` 的寫法（interface + mock 實作 + 匯出單一實例）新增 `peopleService`、`causalChainService`。

---

## 10. 備註

本文件僅為審查與規格設計，**未修改任何 `app/`、`components/`、`lib/` 下的既有程式碼**。待 Codex 依本文件完成實作後，請再次請 Claude 進行 Review，屆時將依 `CLAUDE.md` 既定流程輸出 `REVIEW.md`（Critical / Important / Minor 分類）。
