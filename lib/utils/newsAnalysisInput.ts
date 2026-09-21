import type { NewsItem } from '../types';

export const NEWS_INPUT_BASES=['article-excerpt','rss-content','rss-summary','title-only'] as const;
export type NewsInputBasis=typeof NEWS_INPUT_BASES[number];

/** Keep the existing model/evidence 400-character excerpt boundary aligned.
 * Article text is only eligible if a trusted server integration actually supplied it.
 * No web scraping, guessed text, or client-submitted news is used here.
 */
export function selectNewsAnalysisInput(item:NewsItem):{item:NewsItem;basis:NewsInputBasis}|null {
  const title=item.title.trim();
  const choices:[NewsInputBasis,string|undefined][]=[['article-excerpt',item.articleText],['rss-content',item.rssContent],['rss-summary',item.contentSnippet],['rss-summary',item.summary]];
  const selected=choices.find(([,text])=>!!text?.trim());
  if(!title && !selected) return null;
  if(!selected && (!title || !item.source.trim() || !Number.isFinite(Date.parse(item.publishedAt)))) return null;
  return {item:{...item,title,summary:selected?.[1]?.trim().slice(0,400) ?? ''},basis:selected?.[0] ?? 'title-only'};
}

export function newsInputNotice(basis?:NewsInputBasis):string {
  if(basis==='article-excerpt') return '依已取得的原文節錄分析，未使用完整文章全部內容';
  if(basis==='rss-content') return '依 RSS 提供的內容節錄分析，未確認為完整原文';
  if(basis==='title-only') return '僅依新聞標題、來源與發布時間分析；RSS 未提供摘要，未取得完整原文，資訊有限';
  return '依新聞標題與摘要分析，未取得完整原文';
}
