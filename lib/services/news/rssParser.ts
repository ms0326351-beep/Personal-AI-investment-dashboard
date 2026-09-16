export interface ParsedFeedItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: string; // ISO 8601, from the feed's own pubDate/published field
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => entities[name]);
}
function stripHtml(input: string): string {
  return decodeEntities(input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1] : undefined;
}
function extractLink(block: string): string {
  const selfClosing = block.match(/<link\s+[^>]*href="([^"]*)"[^>]*\/?>/i);
  if (selfClosing) return decodeEntities(selfClosing[1]);
  const withBody = extractTag(block, 'link');
  return withBody ? stripHtml(withBody) : '';
}
function toIso(dateText: string | undefined): string | undefined {
  if (!dateText) return undefined;
  const parsed = new Date(stripHtml(dateText));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Parses RSS 2.0 <item> or Atom <entry> feeds without external dependencies. Skips entries missing a usable title/link/date rather than guessing. */
export function parseFeed(xml: string): ParsedFeedItem[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  const items: ParsedFeedItem[] = [];
  for (const block of blocks) {
    const title = extractTag(block, 'title');
    const link = extractLink(block);
    const summary = extractTag(block, 'description') ?? extractTag(block, 'summary') ?? extractTag(block, 'content') ?? '';
    const publishedAt = toIso(extractTag(block, 'pubDate') ?? extractTag(block, 'published') ?? extractTag(block, 'updated'));
    if (!title || !link || !publishedAt) continue;
    items.push({ title: stripHtml(title), link, summary: stripHtml(summary).slice(0, 400), publishedAt });
  }
  return items;
}
