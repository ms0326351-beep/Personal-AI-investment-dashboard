'use client';
import { useEffect, useRef, useState } from 'react';
import type { PortfolioIntelligenceView } from '@/lib/types/portfolioIntelligence';
import { isPortfolioIntelligenceView } from '@/lib/utils/portfolioIntelligencePresentation';
import { PortfolioIntelligence } from './PortfolioIntelligence';

const pending=new Map<string,Promise<PortfolioIntelligenceView>>();
export async function requestNewsExposure(id:string):Promise<PortfolioIntelligenceView> {
  const existing=pending.get(id);if(existing) return existing;
  const promise=(async()=>{
    const response=await fetch(`/api/news/${encodeURIComponent(id)}/exposure`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new Error('Exposure unavailable');
    const body:unknown=await response.json();
    if(!isPortfolioIntelligenceView(body) || body.newsId!==id) throw new Error('Invalid exposure response');
    return body;
  })();
  pending.set(id,promise);
  try {return await promise;} finally {pending.delete(id);}
}
export function NewsExposurePanel({newsId,active}:{newsId:string;active:boolean}) {
  const [view,setView]=useState<PortfolioIntelligenceView|null>(null);
  const [failed,setFailed]=useState(false),[loading,setLoading]=useState(false);
  const busy=useRef(false),started=useRef(false),mounted=useRef(true);
  async function load() {
    if(busy.current) return;
    busy.current=true;started.current=true;setLoading(true);setFailed(false);
    try {const result=await requestNewsExposure(newsId);if(mounted.current) setView(result);}
    catch {if(mounted.current) setFailed(true);}
    finally {busy.current=false;if(mounted.current) setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(active && !started.current) void load();},[active]); // panel is keyed by newsId
  return <div aria-live="polite" aria-busy={loading}>
    {loading && <p role="status">正在比對本機持股與曝險路徑…</p>}
    {failed && <p role="status">曝險資料暫時無法取得；原有新聞與 AI 分析仍可閱讀。<button className="text-link" disabled={loading} onClick={()=>void load()}>重試曝險資料</button></p>}
    {view && <PortfolioIntelligence view={view}/>}
  </div>;
}
