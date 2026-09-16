'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { NewsAIAnalysis } from '@/lib/types/newsAnalysis';
import { peopleRegistry } from '@/lib/data/peopleRegistry';
import { isNewsAIResponse } from '@/lib/utils/newsAnalysisValidation';

// Share only pending requests (e.g. the same news in the top and full lists).
// Each panel retains its own result; a new request recomputes current holdings.
const pending=new Map<string,Promise<NewsAIAnalysis>>();
export async function requestAnalysis(newsId:string):Promise<NewsAIAnalysis> {
  const existing=pending.get(newsId); if(existing) return existing;
  const request=(async()=>{
    const response=await fetch(`/api/news/${encodeURIComponent(newsId)}/analysis`,{method:'POST',signal:AbortSignal.timeout(45000)});
    if(!response.ok) throw new Error('Analysis request failed');
    const result:unknown=await response.json();
    if(!isNewsAIResponse(result) || result.newsId!==newsId) throw new Error('Invalid analysis response');
    return result;
  })();
  pending.set(newsId,request);
  try {return await request} finally {pending.delete(newsId)}
}
const directionLabels={bullish:'🟢 利多',bearish:'🔴 利空',neutral:'🟡 中性',uncertain:'⚪ 不確定'};
const levelLabels={high:'高',medium:'中',low:'低'};
const relevanceLabels={direct:'直接相關',indirect:'間接相關',none:'無關'};
function SymbolTags({symbols,inferred=false}:{symbols:string[];inferred?:boolean}) {
  return <div className={`news-ai-tags ${inferred?'news-ai-inferred':''}`}>{symbols.map(s=><Link key={s} href={`/stock/${encodeURIComponent(s)}`}>{inferred?'推論：':''}{s}</Link>)}</div>;
}
export function NewsAIAnalysisPanel({newsId}:{newsId:string}) {
  const started=useRef(false);
  const busy=useRef(false);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<NewsAIAnalysis|null>(null);
  const [failed,setFailed]=useState(false);
  async function loadAnalysis() {
    // Guard immediately, before React renders the disabled retry button.
    if(busy.current) return;
    busy.current=true; started.current=true; setLoading(true); setFailed(false);
    try {setResult(await requestAnalysis(newsId))} catch {setFailed(true)} finally {busy.current=false; setLoading(false)}
  }
  return <details className="news-ai-panel" onToggle={event=>{
    if(event.currentTarget.open && !started.current) void loadAnalysis();
  }}>
    <summary>AI 影響分析 ▾</summary>
    <NewsAIAnalysisContent result={result} loading={loading} failed={failed} onRetry={loadAnalysis}/>
  </details>;
}

export function NewsAIAnalysisContent({result,loading=false,failed=false,onRetry}:{result:NewsAIAnalysis|null;loading?:boolean;failed?:boolean;onRetry?:()=>void}) {
  const market=result?.status==='ok'?result.market:null;
  const portfolio=result?.status==='ok'?result.portfolio:null;
  return <div className="news-ai-content" aria-live="polite" aria-busy={loading}>
      <p className="news-ai-notice">AI 分析，非投資建議</p>
      {loading && <p role="status">分析中…</p>}
      {(failed || result?.status==='unavailable') && <p role="status">暫時無法分析：{failed?'連線失敗或等待逾時，請稍後按「重試」。原始新聞仍可閱讀。':result?.unavailableReason}</p>}
      {(failed || result?.status==='unavailable') && onRetry && <button type="button" className="text-link" disabled={loading} onClick={onRetry}>重試 AI 分析</button>}
      {result?.status==='unavailable' && <p className="news-ai-notice">近期分析失敗時，15 分鐘內重試可能仍顯示相同結果；每日上限仍適用。</p>}
      {market && portfolio && <>
        <section className="news-ai-section" aria-label="一般市場影響">
          <h4>一般市場影響</h4>
          {/* AI sentiment colors are independent of .up/.down stock price changes. */}
          <p><span className={`impact-${market.impactDirection}`}>{directionLabels[market.impactDirection]}</span> · 影響程度：{levelLabels[market.impactLevel]}</p>
          {!!market.explicitlyMentionedSymbols.length && <div><p>文中提及（依標題／摘要）</p><SymbolTags symbols={market.explicitlyMentionedSymbols}/></div>}
          {!!market.inferredSymbols.length && <div><p>AI 推論可能影響（非原文點名）</p><SymbolTags symbols={market.inferredSymbols} inferred/></div>}
          {!!market.relatedPersonIds.length && <div><p>相關人物</p><div className="news-ai-tags">{market.relatedPersonIds.map(id=>{
            const person=peopleRegistry.find(p=>p.id===id);
            return person?<Link href={`/people#${id}`} key={id}>{person.name}</Link>:null;
          })}</div></div>}
          {!!market.relatedTopics.length && <p>相關主題／產業：{market.relatedTopics.join('、')}</p>}
          <p>結論：{market.conclusion}</p>
          <p>影響傳導與依據：{market.reasoning}</p>
        </section>
        <section className="news-ai-section" aria-label="與我的投資組合">
          <h4>與我的投資組合</h4>
          <p>關聯程度：{relevanceLabels[portfolio.portfolioRelevance]}</p>
          {!!portfolio.affectedHoldings.length && <div><p>受影響持股</p><SymbolTags symbols={[...new Set(portfolio.affectedHoldings.map(h=>h.symbol))]}/></div>}
          <p>{portfolio.portfolioConclusion}</p>
        </section>
        <p className="news-ai-notice">{result?.disclaimer}</p>
      </>}
    </div>;
}
