# 第二階段：真實市場行情

- 來源：Yahoo Finance Chart 非正式端點，測試用途，無需 API Key、帳號或 Netlify 新環境變數。
- `marketDataService` 是 UI 唯一入口，標記 `server-only`。Yahoo provider 使用伺服器 fetch，7 秒逾時、Next.js 300 秒資料快取。
- `connection()` 使行情在請求時讀取，不會被 production build 固定為一份行情快照。重新整理可取得快取到期後更新的資料；未加入自動輪詢。
- 報價取 `range=1d` 的前交易日收盤基準；月線獨立取 `range=1mo`，不混用月初收盤價算日漲跌。
- 支援 0050 / 0050.TW、2330 / 2330.TW、^TWII、SPY、QQQ、NVDA、AAPL、MSFT。保留既有 2317、VOO，以及美股大盤指數。
- 路由例：`/stock/2330.TW`、`/stock/%5ETWII`、`/stock/SPY`、`/stock/MSFT`。內部台股代號維持 2330、0050，避免破壞既有持股關聯。
- 每檔與每張走勢獨立 fallback；HTTP 失敗、限流、逾時、資料格式錯誤回傳 mock，保留 mock 原始日期與原因，不偽裝為真實最新資料。
- Yahoo 是非正式 API，可能限流、延遲或停止服務，Netlify 出口 IP 也可能被拒絕。UI 顯示來源實際交易時間，不把抓取時間當成交易時間。
- 櫃買指數、持股股數／成本、匯率、產業／殖利率、新聞、人物、AI 摘要仍是 mock；投組估值可能包含備援行情，介面會標註。
- 未新增新聞、GPT 或關鍵人物串接，未自動部署；push 後由原 Netlify Git 流程部署，再檢查線上來源標籤。

驗證：`pnpm run build`；`node node_modules/tsx/dist/cli.mjs --test lib/services/yahooMarketProvider.test.ts lib/calculations/portfolioMath.test.ts`。
