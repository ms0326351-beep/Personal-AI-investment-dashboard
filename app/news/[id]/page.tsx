import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNewsDetail, newsSourceUrl } from '@/lib/services/newsDetailService';
import { NewsAIAnalysisPanel } from '@/components/dashboard/NewsAIAnalysisPanel';

export const runtime='nodejs';
export default async function NewsDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,news=await getNewsDetail(id);
  if(!news) notFound();
  const url=newsSourceUrl(news.url),stamp=Date.parse(news.publishedAt);
  return <>
    <Link className="text-link" href="/dashboard">← 返回市場總覽</Link>
    <article className="card" style={{marginTop:16,overflowWrap:'anywhere'}}>
      <p className="eyebrow">RSS 新聞詳細資料</p><h1>{news.title}</h1>
      <p className="muted">{news.source} · {Number.isFinite(stamp)?<time dateTime={news.publishedAt}>{new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(stamp)}（台北）</time>:'發布時間不明'}</p>
      <p className="scenario-note">以下為來源提供的 RSS 標題與摘要，未取得完整原文。AI 分析為按需服務，展開後才會發送請求；持股關聯使用 Demo / Sample 投組。</p>
      <p>{news.summary || '來源未提供摘要，請閱讀原始新聞。'}</p>
      {news.contentSnippet&&news.contentSnippet!==news.summary&&<p>{news.contentSnippet}</p>}
      {url&&<p><a className="text-link" href={url} target="_blank" rel="noopener noreferrer">閱讀原始新聞 ↗</a></p>}
      <NewsAIAnalysisPanel newsId={news.id}/>
    </article>
  </>;
}
