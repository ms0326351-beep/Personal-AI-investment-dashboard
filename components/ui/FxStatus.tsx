import type { FxSnapshot } from '@/lib/types/fx';
export function FxStatus({data}:{data:FxSnapshot}) {
  const stamp=data.updatedAt?Date.parse(data.updatedAt):NaN;
  return <span role="status">{data.source==='yahoo'?'Yahoo Finance 匯率（可能延遲）':'Demo / Sample 示範匯率'}：1 USD = {data.USD} TWD
    {Number.isFinite(stamp)&&<> · <time dateTime={data.updatedAt!}>{new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(stamp)}（台北）</time></>}
    {data.stale&&' · 舊資料／非即時'}{data.fallbackReason&&` · ${data.fallbackReason}`}
  </span>;
}
