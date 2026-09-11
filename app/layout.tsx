import type { Metadata } from 'next';
import { Navigation } from '@/components/layout/Navigation';
import './globals.css';
export const metadata: Metadata={title:{default:'拾光投資｜市場總覽',template:'%s｜拾光投資'},description:'台美股、ETF 與個人投資組合情報 Dashboard，第一階段模擬資料展示。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body><a className="skip-link" href="#main">跳至主要內容</a><Navigation/><div className="workspace"><header className="topbar"><span>投資工作台 <span className="breadcrumb">／ 每日情報</span></span><span className="mock-badge"><span className="status-dot"/>模擬資料</span></header><main id="main">{children}</main><footer>拾光投資 · 第一階段 MVP <span>行情、新聞及事件皆為模擬範例，非即時資料與投資建議。</span></footer></div></body></html>}
