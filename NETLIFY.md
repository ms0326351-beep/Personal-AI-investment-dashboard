# Netlify 線上測試部署

目前框架為 Next.js 16.3.4（pnpm-lock.yaml 鎖定版本）、App Router、React、TypeScript 與 Tailwind CSS。
保留 Next.js 預設 production build；沒有使用 static export。

## 設定

| 項目 | 值 |
| --- | --- |
| Base directory | 留空（專案位於 Git repository 根目錄時） |
| Build command | `pnpm run build` |
| Publish directory | `.next` |
| Node.js | 24 |
| pnpm | 11.19.0 |

`netlify.toml` 已包含上述設定與 Netlify 建議的 pnpm hoisting 安裝旗標。
Netlify 會自動使用 OpenNext adapter，支援 App Router、SSR 與 Next.js redirect。
不要手動加入 `/* /index.html 200`，不要把 `.next` 當成純靜態網站拖曳上傳。

## 環境變數與秘密

第二階段行情透過伺服器 fetch 讀取 Yahoo Finance Chart，無需 API Key，也不需新增應用程式環境變數。新聞、人物、AI、匯率與持股仍是 mock。行情失敗時逐檔使用有明確標記的 mock 備援，詳見 MARKET-DATA.md。
`.env.example` 的三個空白欄位只是未來串接預留，本次不必填寫。
Node / pnpm 的非機密建置設定已寫入 netlify.toml。
未來金鑰只在 Netlify 環境變數介面設定，透過伺服器端呼叫使用；不得加上 NEXT_PUBLIC_ 前綴。
`.env*`（除空白範例）、node_modules、.next、.netlify 均已排除於 Git。

## 部署步驟

1. 將專案原始碼上傳至 GitHub 等 Git provider 的 repository，包含 package.json、pnpm-lock.yaml、pnpm-workspace.yaml、netlify.toml 與 app/components/lib。
2. Netlify 建立新專案，選擇從 Git 匯入，連結該 repository 與要部署的分支。
3. 確認偵測為 Next.js，建置指令與輸出目錄同上；若專案位於 repository 子目錄，將 Base directory 設為該子目錄。
4. 啟動部署；確認 deploy log 中 Next.js build 及 OpenNext adapter 處理皆成功。
5. 以產生的 https://站名.netlify.app 網址，直接輸入並重新整理以下路由：
   - `/`（導向 `/dashboard`）
   - `/dashboard`
   - `/people`
   - `/portfolio`
   - `/watchlist`
   - `/stock/0050`、`/stock/2330`、`/stock/2317`、`/stock/AAPL`、`/stock/NVDA`、`/stock/VOO`、`/stock/QQQ`
6. 檢查 `/people` 篩選與排序、首頁配置切換、人物錨點與股票連結。

已知未知股票代號會顯示既有找不到標的畫面；人物詳細路由 `/people/[id]` 尚未實作，人物 chip 使用 `/people#人物id`。
本地 production build 與 production server 路由檢查不能代替 Netlify 實際部署驗證；部署後需完成第 5、6 步。

官方參考：https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
