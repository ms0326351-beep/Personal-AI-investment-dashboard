import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRealNews } from './realNewsProvider';
import { newsSources } from './sources';
const now=new Date('2026-09-14T04:00:00Z');
const entry=(title:string,link:string,date=now.toISOString(),summary='Details')=>`<item><title>${title}</title>${link?`<link>${link}</link>`:''}<pubDate>${date}</pubDate><description>${summary}</description></item>`;
const rss=(...entries:string[])=>`<rss><channel>${entries.join('')}</channel></rss>`;
function fetcherFor(feeds:Record<string,string|number|Error>):typeof fetch {
  return async url=>{
    const source=newsSources.find(s=>s.url===String(url));
    const value=source?feeds[source.id]:undefined;
    if(value instanceof Error) throw value;
    if(typeof value==='number') return new Response('',{status:value});
    return new Response(value ?? '',{status:200});
  };
}
test('same link from different sources dedupes, latest copy wins',async()=>{
  const {items}=await fetchRealNews(fetcherFor({fed:rss(entry('Older title','https://example.com/shared','2026-09-14T02:00:00Z')),whitehouse:rss(entry('New title','https://example.com/shared'))}),now);
  assert.equal(items.length,1);assert.equal(items[0].title,'New title');assert.equal(items[0].source,newsSources[1].label);
});
test('linkless normalized-title candidates are rejected before provider dedupe',async()=>{
  // HANDOFF also requires missing-link parser rejection: title-only dedupe is
  // unreachable through fetchRealNews. Preserve that contract rather than mock
  // the parser into accepting articles that production cannot receive.
  const {items,diagnostics}=await fetchRealNews(fetcherFor({fed:rss(entry('AI, Update!','')),whitehouse:rss(entry('ai update',''))}),now);
  assert.deepEqual(items,[]);assert.ok(diagnostics.every(d=>!d.ok));
});
test('distinct articles survive, are newest first, with source and keyword tags',async()=>{
  const {items}=await fetchRealNews(fetcherFor({fed:rss(entry('Jensen Huang discusses NVIDIA','https://example.com/new')),whitehouse:rss(entry('Apple product update','https://example.com/old','2026-09-14T01:00:00Z'))}),now);
  assert.equal(items.length,2);assert.equal(items[0].url,'https://example.com/new');assert.deepEqual(items[0].relatedPersonIds,['jensen-huang']);assert.ok(items[0].relatedSymbols.includes('NVDA'));assert.equal(items[0].origin,'rss');
});
for(const [label,offset,kept] of [
  ['within 48 hours',-47*3600000,true],['exactly 48 hours',-48*3600000,true],['older than 48 hours',-48*3600000-1,false],
  ['future within tolerance',4*60000,true],['exactly five minutes ahead',5*60000,true],['beyond clock tolerance',5*60000+1,false],
] as const) test(`freshness: ${label}`,async()=>{
  const result=await fetchRealNews(fetcherFor({fed:rss(entry('News','https://example.com/date',new Date(now.getTime()+offset).toISOString()))}),now);
  assert.equal(result.items.length,kept?1:0);assert.equal(result.diagnostics[0].ok,true);
});
test('partial rejection, HTTP error and malformed feeds retain good sources',async()=>{
  const {items,diagnostics}=await fetchRealNews(fetcherFor({fed:rss(entry('News','https://example.com/good')),whitehouse:new Error('timeout'),'cna-finance':404,'cna-politics':'not XML'}),now);
  assert.equal(items.length,1);assert.equal(diagnostics.length,newsSources.length);
  assert.deepEqual(diagnostics[0],{id:'fed',label:newsSources[0].label,ok:true,itemCount:1});
  assert.equal(diagnostics[1].ok,false);assert.equal(diagnostics[1].error,'timeout');
  assert.equal(diagnostics[2].error,'HTTP 404');assert.equal(diagnostics[3].error,'Feed returned no parsable items');
  assert.ok(diagnostics.slice(1).every(d=>d.itemCount===0));
});
test('all sources reject: empty items and all failed diagnostics',async()=>{
  const mock:typeof fetch=async()=>{throw new Error('offline')};
  const r=await fetchRealNews(mock,now);assert.deepEqual(r.items,[]);assert.ok(r.diagnostics.every(d=>!d.ok&&d.error==='offline'));
});
test('repeated fetches produce identical IDs and do not accumulate items',async()=>{
  const mock=fetcherFor({fed:rss(entry('News A','https://example.com/a'),entry('News B','https://example.com/b'))});
  const a=await fetchRealNews(mock,now),b=await fetchRealNews(mock,now);
  assert.deepEqual(a.items,b.items);assert.equal(new Set(a.items.map(n=>n.id)).size,2);assert.ok(a.items.every(n=>n.id.startsWith('rss-')));
});
