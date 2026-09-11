'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="card"><h1>資料暫時無法載入</h1><p>請稍後重試。</p><button onClick={reset}>重新載入</button></section>}
