import type { Metadata } from 'next';
import { Navigation } from '@/components/layout/Navigation';
import './globals.css';
export const metadata: Metadata={title:{default:'拾光投資｜市場總覽',template:'%s｜拾光投資'},description:'台美股、ETF 與個人投資組合情報 Dashboard，市場行情與模擬投資研究。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body><a className="skip-link" href="#main">跳至主要內容</a><Navigation/><div className="workspace"><header className="topbar"><span>投資工作台 <span className="breadcrumb">／ 每日情報</span></span><span className="mock-badge"><span className="status-dot"/>行情測試模式</span></header><main id="main">{children}</main><footer>拾光投資 · 市場資料測試 <span>行情可能延遲；行情與 RSS 新聞的備援狀態見各筆資料。人物事件、預寫 AI 摘要、持股與匯率仍為模擬，非投資建議。</span></footer></div></body></html>}
