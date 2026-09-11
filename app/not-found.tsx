import Link from 'next/link';
export default function NotFound(){return <section className="card empty"><p className="eyebrow">404</p><h1>找不到這個標的或頁面</h1><p>目前僅提供模擬清單中的股票與 ETF。</p><Link className="text-link" href="/dashboard">返回市場總覽 →</Link></section>}
