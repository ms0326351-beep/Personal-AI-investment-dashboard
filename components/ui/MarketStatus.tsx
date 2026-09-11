import type { MarketSource } from '@/lib/types/marketSource';
export function MarketStatus({data}:{data:MarketSource & {updatedAt:string}}) {
  const date=Date.parse(data.updatedAt);
  const timestamp=Number.isFinite(date)?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):'尚無時間';
  return <small className="muted" style={{display:'block',fontSize:10,lineHeight:1.8}}>{data.source==='yahoo'?'Yahoo Finance · 最近交易報價（可能延遲）':'模擬資料'}<br/>{timestamp}（台北）{data.fallbackReason&&<span role="status" style={{display:'block'}}>{data.fallbackReason}</span>}</small>;
}
