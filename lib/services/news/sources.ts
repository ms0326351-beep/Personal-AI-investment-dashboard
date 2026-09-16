export interface NewsSourceDef {
  id: string;
  label: string; // shown to the user as NewsItem.source
  url: string;
  lang: 'zh' | 'en';
}

/**
 * All URLs verified working (HTTP 200, real RSS/Atom XML) on 2026-09-11.
 * No API key required for any of these — see NEWS-PEOPLE.md for the verification notes
 * and for sources that were tried and rejected (blocked by bot protection, 404, etc.).
 */
export const newsSources: NewsSourceDef[] = [
  { id: 'fed', label: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', lang: 'en' },
  { id: 'whitehouse', label: 'The White House', url: 'https://www.whitehouse.gov/presidential-actions/feed/', lang: 'en' },
  { id: 'cna-finance', label: '中央社（財經）', url: 'https://feeds.feedburner.com/rsscna/finance', lang: 'zh' },
  { id: 'cna-politics', label: '中央社（政治）', url: 'https://feeds.feedburner.com/rsscna/politics', lang: 'zh' },
  { id: 'apple', label: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss', lang: 'en' },
  { id: 'nvidia', label: 'NVIDIA Newsroom', url: 'https://nvidianews.nvidia.com/rss.xml', lang: 'en' },
  { id: 'yahoo-finance', label: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', lang: 'en' },
  { id: 'cnbc-top', label: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', lang: 'en' },
  { id: 'cnbc-tech', label: 'CNBC Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', lang: 'en' },
  { id: 'marketwatch', label: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', lang: 'en' },
];
