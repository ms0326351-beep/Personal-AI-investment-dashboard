import type { NewsItem } from '@/lib/types';
import { newsSources, type NewsSourceDef } from './sources';
import { parseFeed, type ParsedFeedItem } from './rssParser';
import { matchAliasesInText } from '@/lib/utils/textMatch';
import { peopleRegistry } from '@/lib/data/peopleRegistry';
import { symbolAliases } from '@/lib/data/symbolAliases';

export interface SourceFetchResult { id: string; label: string; ok: boolean; itemCount: number; error?: string }
export interface RealNewsResult { items: NewsItem[]; diagnostics: SourceFetchResult[] }

const personAliasMap: Record<string, string[]> = Object.fromEntries(
  peopleRegistry.filter(p => p.aliases.length).map(p => [p.id, p.aliases]),
);

const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Normalizes a title (strip punctuation/whitespace, lowercase) so near-identical
 *  headlines from different outlets collapse to the same dedupe key when no link match. */
function normalizedTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

async function fetchSource(source: NewsSourceDef, fetcher: typeof fetch): Promise<ParsedFeedItem[]> {
  const response = await fetcher(source.url, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 1800 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  const items = parseFeed(xml);
  if (!items.length) throw new Error('Feed returned no parsable items');
  return items;
}

/**
 * Fetches every configured RSS/Atom source in parallel, tolerating individual
 * source failures, then normalizes/dedupes/freshness-filters and tags each item
 * with matched tracked people/symbols via deterministic keyword matching (no AI).
 */
export async function fetchRealNews(fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<RealNewsResult> {
  const settled = await Promise.allSettled(newsSources.map(source => fetchSource(source, fetcher)));

  const diagnostics: SourceFetchResult[] = [];
  const raw: { source: NewsSourceDef; item: ParsedFeedItem }[] = [];
  settled.forEach((result, i) => {
    const source = newsSources[i];
    if (result.status === 'fulfilled') {
      diagnostics.push({ id: source.id, label: source.label, ok: true, itemCount: result.value.length });
      result.value.forEach(item => raw.push({ source, item }));
    } else {
      diagnostics.push({ id: source.id, label: source.label, ok: false, itemCount: 0, error: String((result.reason as Error)?.message ?? result.reason) });
    }
  });

  raw.sort((a, b) => Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt));

  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const { source, item } of raw) {
    const ageMs = now.getTime() - Date.parse(item.publishedAt);
    if (ageMs > FRESHNESS_WINDOW_MS || ageMs < -CLOCK_SKEW_TOLERANCE_MS) continue;
    const key = item.link || normalizedTitleKey(item.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const text = `${item.title} ${item.summary}`;
    items.push({
      id: `rss-${hash(key)}`,
      title: item.title,
      summary: item.summary,
      ...(item.rssContent?{rssContent:item.rssContent}:{}),
      ...(item.contentSnippet?{contentSnippet:item.contentSnippet}:{}),
      source: source.label,
      url: item.link,
      publishedAt: item.publishedAt,
      relatedSymbols: matchAliasesInText(text, symbolAliases),
      relatedPersonIds: matchAliasesInText(text, personAliasMap),
      origin: 'rss',
    });
  }
  return { items, diagnostics };
}
