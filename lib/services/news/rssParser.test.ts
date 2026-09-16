import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from './rssParser';
const date = 'Mon, 14 Sep 2026 01:00:00 GMT';
const item = (body:string) => `<rss><channel><item>${body}</item></channel></rss>`;
test('RSS 2.0 parses title, link, summary and source date including BOM',()=>{
  assert.deepEqual(parseFeed('\uFEFF'+item(`<title>Market update</title><link>https://example.com/news</link><description>Details</description><pubDate>${date}</pubDate>`)),[{title:'Market update',link:'https://example.com/news',summary:'Details',publishedAt:'2026-09-14T01:00:00.000Z'}]);
});
test('Atom self-closing links, published and summary',()=>{
  assert.deepEqual(parseFeed('<feed><entry><title>Apple update</title><link href="https://example.com/a?x=1&amp;y=2"/><published>2026-09-14T09:00:00+08:00</published><summary>Summary</summary></entry></feed>'),[{title:'Apple update',link:'https://example.com/a?x=1&y=2',publishedAt:'2026-09-14T01:00:00.000Z',summary:'Summary'}]);
});
test('Atom updated/content fallback and published precedence',()=>{
  const xml='<entry><title>Update</title><link href="https://example.com/a"/><updated>2026-09-14T02:00:00Z</updated><content>Content</content></entry>';
  assert.equal(parseFeed(xml)[0].summary,'Content');
  assert.equal(parseFeed(xml)[0].publishedAt,'2026-09-14T02:00:00.000Z');
  assert.equal(parseFeed(xml.replace('<updated>','<published>2026-09-14T01:00:00Z</published><updated>'))[0].publishedAt,'2026-09-14T01:00:00.000Z');
});
test('CDATA, HTML tags, named and numeric entities are decoded',()=>{
  const [parsed]=parseFeed(item(`<title><![CDATA[<b>Fed</b> &amp; &#39;AI&#39;]]></title><link>https://example.com</link><pubDate>${date}</pubDate><description><![CDATA[<p>A&nbsp;B &#x26; &quot;C&quot;</p>]]></description>`));
  assert.equal(parsed.title,"Fed & 'AI'");assert.equal(parsed.summary,'A B & "C"');
});
for(const [name,body] of [
  ['missing title',`<link>https://example.com</link><pubDate>${date}</pubDate>`],
  ['missing link',`<title>News</title><pubDate>${date}</pubDate>`],
  ['missing date','<title>News</title><link>https://example.com</link>'],
  ['invalid date','<title>News</title><link>https://example.com</link><pubDate>not-a-date</pubDate>'],
]) test(`skips ${name}`,()=>assert.deepEqual(parseFeed(item(body)),[]));
for(const input of ['', 'not XML', '<rss><channel></channel></rss>', '<item><title>Unclosed']) test(`invalid/empty input: ${input || '(empty)'}`,()=>assert.deepEqual(parseFeed(input),[]));
test('summary is capped at 400 characters',()=>{
  const [parsed]=parseFeed(item(`<title>News</title><link>https://example.com</link><pubDate>${date}</pubDate><description>${'文'.repeat(450)}</description>`));
  assert.equal(parsed.summary,'文'.repeat(400));
});
test('invalid entries do not remove valid siblings; missing summary is allowed',()=>{
  const xml=`<item><title>Bad</title></item><item><title>Good</title><link>https://example.com</link><pubDate>${date}</pubDate></item>`;
  assert.equal(parseFeed(xml).length,1);assert.equal(parseFeed(xml)[0].summary,'');
});
