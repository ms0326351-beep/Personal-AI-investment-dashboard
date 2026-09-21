import Link from 'next/link';
import type { HoldingImpact, MarketImpactAnalysis, PortfolioImpactAnalysis, WatchFactor } from '@/lib/types/newsAnalysis';
import { displayScenarios, displayWatchFactors, portfolioRelationshipLabel } from '@/lib/utils/newsAnalysisPresentation';

export const horizonLabels={'immediate':'即時','short-term':'短期','medium-term':'中期','long-term':'長期'};
const levels={low:'低',medium:'中',high:'高'};
const directions={positive:'偏正面',negative:'偏負面',mixed:'正負並存',uncertain:'不確定'};
const marketDirections={bullish:'偏多',bearish:'偏空',neutral:'中性',uncertain:'不確定'};
const eventLabels={earnings:'財報','monetary-policy':'貨幣政策','trade-policy':'貿易政策',geopolitics:'地緣政治',product:'產品','supply-chain':'供應鏈',dividend:'股利','management-change':'經營團隊異動',other:'其他'};
const stages={event:'新聞事件',macro:'總體變數',industry:'產業',security:'公司／ETF'};
const factorTypes={market:'市場',macro:'總體',company:'公司',industry:'產業',policy:'政策',commodity:'商品',currency:'匯率',rate:'利率'};

export function InvestmentSummary({market,portfolio}:{market:MarketImpactAnalysis;portfolio:PortfolioImpactAnalysis|null}) {
  return <section className="news-ai-card news-ai-overview" aria-label="AI 投資影響摘要">
    <h4>AI 投資影響摘要</h4>
    <dl className="news-ai-summary-metrics">
      <div><dt>市場方向</dt><dd><span className={`impact-${market.impactDirection}`}>{marketDirections[market.impactDirection]}</span></dd></div>
      <div><dt>影響程度</dt><dd>{levels[market.impactLevel]}</dd></div>
      <div><dt>我的持股關聯</dt><dd>{portfolioRelationshipLabel(portfolio)}</dd></div>
    </dl>
    <p className="news-ai-key-conclusion">{market.conclusion}</p>
    <p className="news-ai-secondary">{market.eventHorizon?`主要影響期間：${horizonLabels[market.eventHorizon]} · `:''}事件影響判斷，非價格預測。關聯類型不代表持倉比重。</p>
  </section>;
}

export function WatchFactors({factors,compact=false}:{factors:WatchFactor[]|undefined;compact?:boolean}) {
  const visible=displayWatchFactors(factors,compact?3:undefined);
  return <section className="news-ai-card" aria-label={compact?'接下來觀察':'全部觀察指標'}>
    <h4>{compact?'接下來觀察':'全部觀察指標'}</h4>
    {visible.length?<ul className="news-ai-watch">{visible.map(f=><li key={f.name}>
      <span className="news-ai-factor-name">{f.name}</span><small>{factorTypes[f.type]}</small><p>{f.reason}</p>
    </li>)}</ul>:<p className="news-ai-secondary">目前沒有足夠資料提供具體觀察指標。</p>}
    {!compact && <p className="news-ai-secondary">依分析提供的順序呈現；未提供具體數字門檻，不自行推定。</p>}
  </section>;
}

export function DeepEventSummary({market}:{market:MarketImpactAnalysis}) {
  if(!market.eventSummary) return null;
  return <section className="news-ai-card" aria-label="事件摘要">
    <h4>事件摘要</h4><p>{market.eventSummary}</p>
    <p className="news-ai-secondary">事件類型：{eventLabels[market.eventType]}{market.eventImportance?` · 重要程度：${levels[market.eventImportance]}`:''}。依標題／摘要整理，未查核原文全文。</p>
  </section>;
}

export function TransmissionPath({steps}:{steps:string[]}) {
  return <ol className="news-ai-transmission" aria-label="AI 推論傳導路徑">{steps.map((step,i)=><li key={i}><span>{step}</span>{i<steps.length-1 && <span className="news-ai-path-arrow" aria-hidden="true">→</span>}</li>)}</ol>;
}

export function DeepImpactChain({market,holdings}:{market:MarketImpactAnalysis;holdings:HoldingImpact[]}) {
  return <section className="news-ai-card" aria-label="影響傳導路徑"><h4>影響傳導路徑</h4>
    {market.impactChain?.length?<ol className="news-ai-chain">{market.impactChain.map((node,i)=><li key={i}>
      <span className="news-ai-node-type">{stages[node.stage]} · {node.basis==='reported'?'新聞描述':'AI 推論'}</span><strong>{node.label}</strong><p>{node.explanation}</p>
    </li>)}<li><span className="news-ai-node-type">我的持股 · 本機資料比對</span>
      <strong>{holdings.length?holdings.map(h=>`${h.symbol} ${h.name}`).join('、'):'未找到足夠關聯依據'}</strong>
      <p>關聯不代表價格必然變動。</p>
    </li></ol>:<p className="news-ai-secondary">此份分析沒有結構化傳導路徑。{market.reasoning}</p>}
    {!!holdings.length && <div className="news-ai-holding-paths">{holdings.map(h=><section key={h.symbol}>
      <h5><Link href={`/stock/${encodeURIComponent(h.symbol)}`}>{h.symbol} {h.name}</Link> · {h.relationship==='direct'?'直接':'間接'}關聯</h5>
      <div className="news-ai-metrics"><span>可能方向：{directions[h.impactDirection]}</span><span>影響程度：{levels[h.impactLevel]}</span></div>
      <p>{h.reason}</p><TransmissionPath steps={h.transmissionPath}/>
      <p className="news-ai-secondary">信心：{levels[h.confidence]} · 期間：{horizonLabels[h.timeHorizon]} · 傳導為 AI 推論</p>
      <p className="news-ai-secondary">新聞引文（標題／摘要）</p><blockquote>{h.evidenceQuote}</blockquote>
      {!!h.watchFactors.length && <><h5>持股觀察項目</h5><ul className="news-ai-holding-watch">{displayWatchFactors(h.watchFactors).map(f=><li key={f.name}><strong>{f.name}</strong>：{f.reason}</li>)}</ul></>}
    </section>)}</div>}
  </section>;
}

export function PortfolioOverview({portfolio}:{portfolio:PortfolioImpactAnalysis|null}) {
  const holdings=portfolio?.holdingImpacts ?? [];
  const visible=holdings.slice(0,2);
  return <section className="news-ai-card news-ai-portfolio" aria-label="我的投資組合影響"><h4>我的投資組合影響</h4>
    {visible.length?<div className="news-ai-holdings">{visible.map(h=><article className="news-ai-holding" key={h.symbol}>
      <h5><Link href={`/stock/${encodeURIComponent(h.symbol)}`}>{h.symbol} {h.name}</Link></h5>
      <div className="news-ai-metrics"><span>{h.relationship==='direct'?'直接關聯':'間接關聯（推論）'}</span><span>{directions[h.impactDirection]}</span><span>影響程度：{levels[h.impactLevel]}</span></div>
      <p className="news-ai-brief-reason"><strong>原因：</strong>{h.reason}</p><TransmissionPath steps={h.transmissionPath}/>
    </article>)}</div>:<>
      <p>目前沒有足夠資料確認直接影響</p>
      <p className="news-ai-secondary">{portfolio?.portfolioConclusion || '目前沒有可用的持股關聯分析。'}</p>
      {portfolio && !portfolio.holdingImpacts && !!portfolio.affectedHoldings.length && <p className="news-ai-secondary">舊版分析涉及 {Array.from(new Set(portfolio.affectedHoldings.map(h=>h.symbol))).join('、')}，未提供逐檔傳導資料，不補推個別影響。</p>}
    </>}
    {holdings.length>2 && <p className="news-ai-secondary">另有 {holdings.length-2} 檔相關持股，請展開下方「查看完整深度分析」。</p>}
  </section>;
}

export function DeepScenarios({market}:{market:MarketImpactAnalysis}) {
  const scenarios=displayScenarios(market);
  return <section className="news-ai-card" aria-label="接下來可能出現的情境"><h4>接下來可能出現的情境</h4>
    <p className="news-ai-secondary">條件式推論，非價格預測；基準情境不等於市場中性。</p>
    {scenarios.length?<div className="news-ai-scenarios">{scenarios.map(s=><article key={s.key} className={`news-ai-scenario news-ai-scenario-${s.key}`}><h5>{s.label}</h5><p>{s.description}</p></article>)}</div>:<p className="news-ai-secondary">此份分析未提供情境資料。</p>}
    {!!scenarios.length && <p className="news-ai-secondary">原分析未分欄提供觸發條件、市場反應及逐情境標的，以上保留原有描述，不額外推定。</p>}
    {market.whatWouldChangeTheView && <p><strong>改變判斷的關鍵：</strong>{market.whatWouldChangeTheView}</p>}
  </section>;
}

export function AnalysisLimitations({market}:{market:MarketImpactAnalysis}) {
  return <section className="news-ai-card news-ai-limitations" aria-label="分析限制與不確定性"><h4>分析限制與不確定性</h4>
    {!!market.uncertainties?.length && <><h5>本次分析仍不確定的因素</h5><ul>{market.uncertainties.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
    <h5>資料與方法限制</h5><ul><li>新聞資訊可能更新；分析依標題與摘要，未查核全文。</li><li>事件與市場價格不一定存在直接因果，AI 可能遺漏其他因素。</li><li>ETF 成分與權重可能變動，不能由此分析確認即時曝險。</li></ul>
  </section>;
}
