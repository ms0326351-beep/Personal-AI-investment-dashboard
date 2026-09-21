import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsItemSnapshots, resolveNewsForAnalysis } from './newsItemSnapshots';
import type { AnalysisBlobStore } from '../ai/newsAnalysisCache';
import type { NewsItem } from '../../types';
const item:NewsItem={id:'rss-retained',title:'NVIDIA demand update',summary:'Demand remains uncertain.',source:'Test',url:'https://example.com/news',publishedAt:'2026-09-16T00:00:00Z',relatedSymbols:['NVDA'],origin:'rss'};
function store():AnalysisBlobStore {
  let data:unknown=null,version=0;
  return {async getWithMetadata(){return data?{data:structuredClone(data),etag:String(version)}:null},async setJSON(_key,value,condition){
    if(condition && (('onlyIfNew' in condition && data)||('onlyIfMatch' in condition && condition.onlyIfMatch!==String(version)))) return {modified:false};
    data=structuredClone(value);version++;return {modified:true};
  }};
}
test('displayed item remains resolvable after it leaves the feed; no refetch required',async()=>{
  const snapshots=createNewsItemSnapshots(()=>store());await snapshots.remember([item]);
  const found=await resolveNewsForAnalysis(item.id,{snapshots,fetchNews:async()=>{throw Error('must not refetch')}});
  assert.deepEqual(found,item);
});
test('snapshots survive a new instance using shared persistent storage',async()=>{
  const blobs=store();await createNewsItemSnapshots(()=>blobs).remember([item]);
  assert.deepEqual(await createNewsItemSnapshots(()=>blobs).find(item.id),item);
});
test('new feed snapshots retain previous displayed articles across instances',async()=>{
  const blobs=store();await createNewsItemSnapshots(()=>blobs).remember([item]);
  const next=createNewsItemSnapshots(()=>blobs);await next.remember([{...item,id:'rss-next'}]);
  const reader=createNewsItemSnapshots(()=>blobs);
  assert.equal((await reader.find(item.id))?.id,item.id);assert.equal((await reader.find('rss-next'))?.id,'rss-next');
});
test('memory fallback retains original news without inventing content during storage outage',async()=>{
  let warnings=0;const snapshots=createNewsItemSnapshots(()=>{throw Error('offline')},Date.now,()=>warnings++);
  await snapshots.remember([item]);const found=await snapshots.find(item.id);assert.deepEqual(found,item);assert.equal(warnings,1);
  found!.summary='mutated';assert.equal((await snapshots.find(item.id))?.summary,item.summary);
});
test('snapshot miss fetches current feed once and retains its item',async()=>{
  const snapshots=createNewsItemSnapshots(()=>store());let calls=0;
  const options={snapshots,fetchNews:async()=>{calls++;return {items:[item],diagnostics:[]}}};
  assert.deepEqual(await resolveNewsForAnalysis(item.id,options),item);assert.deepEqual(await resolveNewsForAnalysis(item.id,options),item);assert.equal(calls,1);
});
test('unknown ID returns null, expired and mock items are not retained',async()=>{
  let now=1000;const blobs=store(),snapshots=createNewsItemSnapshots(()=>blobs,()=>now);
  await snapshots.remember([item,{...item,id:'rss-mock',origin:'mock'}]);
  assert.equal(await snapshots.find('rss-mock'),null);now+=48*3600000+1;assert.equal(await snapshots.find(item.id),null);
  assert.equal(await resolveNewsForAnalysis('rss-missing',{snapshots,fetchNews:async()=>({items:[],diagnostics:[]})}),null);
});
test('concurrent writers keep both sets and snapshot memory is bounded',async()=>{
  const blobs=store(),a=createNewsItemSnapshots(()=>blobs),b=createNewsItemSnapshots(()=>blobs);
  await Promise.all([a.remember([item]),b.remember([{...item,id:'rss-other'}])]);
  const reader=createNewsItemSnapshots(()=>blobs);assert.ok(await reader.find(item.id));assert.ok(await reader.find('rss-other'));
  await a.remember(Array.from({length:510},(_,i)=>({...item,id:`rss-limit${i}`})));
  const stored=await blobs.getWithMetadata('recent-items-v1',{type:'json',consistency:'strong'});assert.equal((stored?.data as unknown[]).length,500);
});
