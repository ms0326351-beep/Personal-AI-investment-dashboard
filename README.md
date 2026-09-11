# 拾光投資 Dashboard

Next.js App Router、TypeScript、Tailwind CSS。介面為繁體中文，全部使用固定模擬資料。

## 本地執行

需要 Node.js 20.9+ 與 pnpm。

```sh
pnpm install
pnpm dev
```

瀏覽 http://localhost:3000 。同一區域網路的手機可使用開發電腦的 IP 與連接埠 3000（需防火牆允許）。

```sh
pnpm typecheck
pnpm test
pnpm build
```

## 第一階段

- `/dashboard`：台美市場、0050、投資組合、新聞、事件、模擬 AI 摘要、配置圖與觀察清單。
- `/portfolio`、`/watchlist`：唯讀模擬資料，標的可連到研究頁。
- `/stock/0050`（以及 2330、2317、AAPL、NVDA、VOO、QQQ）：基本資料、模擬月線、新聞與研究摘要。
- UI 透過 services 取得資料。投組計算集中在純函式，固定匯率 1 USD = 32 TWD。
- 桌機側欄、手機底部導覽；配置分類可切換。

## 下一階段

持股與 Watchlist CRUD、localStorage、表單驗證，以及走勢區間切換。真實市場 API、AI API、登入與下單均未串接。

`.env.example` 僅預留未來伺服器端金鑰；不可加 NEXT_PUBLIC_ 前綴。
