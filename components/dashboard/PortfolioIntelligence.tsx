import type { IntelligenceMetric, IntelligencePath, PortfolioIntelligenceView } from '@/lib/types/portfolioIntelligence';
import { safeEvidenceUrl } from '@/lib/utils/portfolioIntelligencePresentation';

const statusText={KNOWN:'已知路徑 · KNOWN',PARTIAL:'部分資料 · PARTIAL',UNKNOWN:'資料不足 · UNKNOWN'};
function Metrics({items}:{items:IntelligenceMetric[]}) {
  return <dl className="exposure-metrics">{items.map((m,i)=><div key={i}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>;
}
export function ExposurePathDetails({path}:{path:IntelligencePath}) {
  return <details className="exposure-path"><summary>{path.order}路徑 · 可信度 {path.confidence} · {path.coverage}</summary>
    <p className="exposure-muted">以下為條件式傳導；來源記載的關係不代表事件影響已證實。</p>
    {!!path.scenario.length && <p>條件式情境：{path.scenario.join('；')}</p>}
    <ol>{path.steps.map((s,i)=><li key={i}>
      <strong>{s.from} → {s.to}</strong><p>{s.relationship} · {s.basis}</p>
      <small>可信度：{s.confidence} · 資料日期：{s.date || '未知'}（請留意時效）</small>
      <details><summary>查看這一跳的依據</summary>
        {s.evidence.length?s.evidence.map((e,j)=><p key={j}>{e}</p>):<p>尚無可供查核的證據</p>}
        {s.sources.map((source,j)=><p key={j}>{safeEvidenceUrl(source.url)?<a href={safeEvidenceUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>:<span>{source.title}</span>}<br/><small>{source.date}</small></p>)}
        {!!s.conditions.length && <p>可能失效的條件：{s.conditions.join('；')}</p>}
      </details>
    </li>)}</ol>
  </details>;
}
export function PortfolioIntelligence({view,mode='news'}:{view:PortfolioIntelligenceView;mode?:'news'|'portfolio'}) {
  return <section className="exposure-panel" aria-label={mode==='news'?'投資組合影響 · 曝險路徑':'投資組合曝險視角'}>
    <h3>{mode==='news'?'投資組合影響 · 曝險路徑':'投資組合曝險視角'}</h3>
    <span className="exposure-badge">{statusText[view.status]}</span>
    <p className="exposure-muted">{mode==='news'?'這則事件如何連到我的持股？':'看見不同持股背後可能重疊的風險。'} 估值／查詢時間：{view.asOf}</p>
    {mode==='news' && <p className="exposure-muted">本區依本機持股與來源關聯比對，與 AI 觀點分開；缺少傳導規則時，不自行判定影響方向。</p>}
    {view.notes.map((note,i)=><p className="exposure-muted" key={i}>{note}</p>)}
    {mode==='news' && <>
      {!view.holdings.length && <p>目前沒有可確認的持股關聯，不代表曝險為零。</p>}
      <div className="exposure-holdings">{view.holdings.map(h=><article key={h.id}>
        <h4>{h.symbol} · {h.title}</h4><span className="exposure-badge">{statusText[h.status]}</span>
        <div className="exposure-badges">{h.badges.map(b=><span className="exposure-badge" key={b}>{b}</span>)}</div>
        <Metrics items={h.metrics.filter(m=>['影響方向','可信度','持股權重（估算）','合計已知關聯曝險'].includes(m.label))}/>
        <details><summary>為什麼會影響我？</summary>
          <Metrics items={h.metrics.filter(m=>!['影響方向','可信度','持股權重（估算）','合計已知關聯曝險'].includes(m.label))}/>
          {!h.paths.length && <p>尚無具備足夠資料的連結路徑；可能是新聞未提及、關聯或 ETF 成分資料不足，不能解讀為沒有影響。</p>}
          {h.paths.map(p=><ExposurePathDetails key={p.id} path={p}/>)}
        </details>
      </article>)}</div>
      <details><summary>二階 / 三階影響 · {view.higherOrder.length} 條路徑</summary>
        <p className="exposure-muted">以下為條件式傳導，不代表持有比例或已發生事實；完整持股連結請見上方「為什麼」。</p>
        {!view.higherOrder.length && <p>目前沒有具備足夠資料的多跳路徑，不自動補造供應鏈或未來需求。</p>}
        {view.higherOrder.map(p=><ExposurePathDetails key={p.id} path={p}/>)}
      </details>
    </>}
    {mode==='portfolio' && view.groups.map(g=><details className="exposure-group" key={g.title}>
      <summary>{g.title} <span className="exposure-badge">{statusText[g.status]}</span></summary>
      <p>{g.note}</p>{g.metrics.length?<Metrics items={g.metrics}/>:<p>目前沒有足夠資料量化此曝險；不代表零曝險或沒有重疊。</p>}
    </details>)}
  </section>;
}
