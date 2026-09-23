'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NewsExposurePanel } from './NewsExposurePanel';
import Link from 'next/link';
import type { NewsAIAnalysis } from '@/lib/types/newsAnalysis';
import { peopleRegistry } from '@/lib/data/peopleRegistry';
import { isNewsAIResponse } from '@/lib/utils/newsAnalysisValidation';
import { newsInputNotice } from '@/lib/utils/newsAnalysisInput';
import { AnalysisLimitations, DeepEventSummary, DeepImpactChain, DeepScenarios, InvestmentSummary, PortfolioOverview, WatchFactors } from './DeepNewsAnalysis';

// Share only pending requests (e.g. the same news in the top and full lists).
// Each panel retains its own result; a new request recomputes current holdings.
const pending=new Map<string,Promise<NewsAIAnalysis>>();
export async function requestAnalysis(newsId:string,retry=false):Promise<NewsAIAnalysis> {
  const existing=pending.get(newsId); if(existing) return existing;
  const request=(async()=>{
    const response=await fetch(`/api/news/${encodeURIComponent(newsId)}/analysis`,{method:'POST',headers:retry?{'X-News-Analysis-Retry':'1'}:undefined,signal:AbortSignal.timeout(45000)});
    if(!response.ok) throw new Error('Analysis request failed');
    const result:unknown=await response.json();
    if(!isNewsAIResponse(result) || result.newsId!==newsId) throw new Error('Invalid analysis response');
    return result;
  })();
  pending.set(newsId,request);
  try {return await request} finally {pending.delete(newsId)}
}
function SymbolTags({symbols,inferred=false}:{symbols:string[];inferred?:boolean}) {
  return <div className={`news-ai-tags ${inferred?'news-ai-inferred':''}`}>{symbols.map(s=><Link key={s} href={`/stock/${encodeURIComponent(s)}`}>{inferred?'推論：':''}{s}</Link>)}</div>;
}
export function NewsAIAnalysisPanel({newsId}:{newsId:string}) {
  const started=useRef(false);
  const busy=useRef(false);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<NewsAIAnalysis|null>(null);
  const [failed,setFailed]=useState(false);
  const [exposureActive,setExposureActive]=useState(false);
  async function loadAnalysis(retry=false) {
    // Guard immediately, before React renders the disabled retry button.
    if(busy.current) return;
    busy.current=true; started.current=true; setLoading(true); setFailed(false);
    try {setResult(await requestAnalysis(newsId,retry))} catch {setFailed(true)} finally {busy.current=false; setLoading(false)}
  }
  return <details className="news-ai-panel" onToggle={event=>{
    if(event.target===event.currentTarget && event.currentTarget.open) {
      setExposureActive(true);
      if(!started.current) void loadAnalysis();
    }
  }}>
    <summary>AI 影響分析 ▾</summary>
    <NewsAIAnalysisContent result={result} loading={loading} failed={failed} onRetry={()=>void loadAnalysis(true)} intelligence={<NewsExposurePanel key={newsId} newsId={newsId} active={exposureActive}/>}/>
  </details>;
}

export function NewsAIAnalysisContent({result,loading=false,failed=false,onRetry,intelligence}:{result:NewsAIAnalysis|null;loading?:boolean;failed?:boolean;onRetry?:()=>void;intelligence?:ReactNode}) {
  const [clock,setClock]=useState(()=>Date.now());
  const retryAt=Date.parse(result?.retryAt ?? '');
  const remaining=Number.isFinite(retryAt)?Math.max(0,Math.ceil((retryAt-clock)/1000)):0;
  useEffect(()=>{
    if(!Number.isFinite(retryAt)) return;
    setClock(Date.now());
    const timer=setInterval(()=>setClock(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[retryAt]);
  const market=result?.status==='ok'?result.market:null;
  const portfolio=result?.status==='ok'?result.portfolio:null;
  return <div className="news-ai-content" aria-live="polite" aria-busy={loading}>
      <p className="news-ai-notice">AI 分析，非投資建議</p>
      {loading && <p role="status">分析中…</p>}
      {(failed || result?.status==='unavailable') && <p role="status">暫時無法分析：{failed?'連線失敗或等待逾時，請稍後按「重試」。原始新聞仍可閱讀。':result?.unavailableReason}</p>}
      {(failed || result?.status==='unavailable') && onRetry && <button type="button" className="text-link" disabled={loading || remaining>0} onClick={onRetry}>重試 AI 分析</button>}
      {result?.status==='unavailable' && <p className="news-ai-notice">{remaining>0?`請於 ${remaining} 秒後重試。`:'重試會重新嘗試分析；成功結果仍使用快取。'}每日上限仍適用。{result.errorCode && `（${result.errorCode}）`}</p>}
      {market && <>
        <p className="news-ai-notice" role="note">{newsInputNotice(result?.inputBasis)}</p>
        <InvestmentSummary market={market} portfolio={portfolio}/>
        <PortfolioOverview portfolio={portfolio}/>
        {intelligence}
        <WatchFactors factors={market.watchFactors} compact/>
        <details className="news-ai-deep-details news-ai-full"><summary>查看完整深度分析</summary>
        <div className="news-ai-full-content">
        <DeepEventSummary market={market}/>
        <section className="news-ai-card" aria-label="一般市場影響">
          <h4>一般市場影響</h4>
          {!!market.explicitlyMentionedSymbols.length && <div><p>文中提及（依標題／摘要）</p><SymbolTags symbols={market.explicitlyMentionedSymbols}/></div>}
          {!!market.inferredSymbols.length && <div><p>AI 推論可能影響（非原文點名）</p><SymbolTags symbols={market.inferredSymbols} inferred/></div>}
          {!!market.relatedPersonIds.length && <div><p>相關人物</p><div className="news-ai-tags">{market.relatedPersonIds.map(id=>{
            const person=peopleRegistry.find(p=>p.id===id);
            return person?<Link href={`/people#${id}`} key={id}>{person.name}</Link>:null;
          })}</div></div>}
          {!!market.relatedTopics.length && <p>相關主題／產業：{market.relatedTopics.join('、')}</p>}
          <p>影響傳導與依據：{market.reasoning}</p>
        </section>
        <DeepImpactChain market={market} holdings={portfolio?.holdingImpacts ?? []}/>
        <DeepScenarios market={market}/>
        <WatchFactors factors={market.watchFactors}/>
        <AnalysisLimitations market={market}/>
        </div>
        </details>
        <p className="news-ai-notice">{result?.disclaimer}</p>
      </>}
      {!market && intelligence}
    </div>;
}
