import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsAnalysisProvider, getNewsAIModel, DEFAULT_NEWS_AI_MODEL } from './newsAnalysisProvider';
import type { NewsItem } from '../../types';
import { deepFixture } from '../../utils/deepNewsAnalysis.fixture';
import { NewsAnalysisError } from './newsAnalysisError';
const item:NewsItem={id:'rss-test',title:'NVIDIA discusses AI',summary:'Jensen Huang discusses demand.',source:'Test RSS',publishedAt:'2026-09-14T00:00:00Z',relatedSymbols:['NVDA'],relatedPersonIds:['jensen-huang'],origin:'rss'};
const people=[{id:'jensen-huang',name:'黃仁勳',title:'執行長',organization:'NVIDIA'}];
const market={...deepFixture,impactChain:deepFixture.impactChain.map(n=>({...n,basis:'inferred' as const})),explicitlyMentionedSymbols:['NVDA'],inferredSymbols:[],relatedPersonIds:['jensen-huang'],relatedTopics:['AI'],eventType:'product',impactDirection:'uncertain',impactLevel:'low',conclusion:'需求可能影響供應鏈。',reasoning:'需求→半導體→NVDA，仍需觀察採購落實。'};
const response=(value:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
const provider=(fetcher:typeof fetch)=>createNewsAnalysisProvider({fetcher,apiKey:()=> 'test-only-key'});
test('valid structured result including uncertain is returned',async()=>{
  assert.deepEqual(await provider(async()=>response(market)).analyzeNews(item,people,['NVDA','QQQ']),market);
});
test('out-of-candidate values are filtered and inferred overlap removed',async()=>{
  const r=await provider(async()=>response({...market,explicitlyMentionedSymbols:['NVDA','MSFT'],inferredSymbols:['NVDA','QQQ','BAD'],relatedPersonIds:['invented','jensen-huang']})).analyzeNews(item,people,['NVDA','QQQ']);
  assert.deepEqual(r,market);
});
test('request enforces strict schema, candidate bounds, limits and data-only prompt',async()=>{
  let body:Record<string,any>={};
  const p=provider(async(url,init)=>{
    assert.equal(String(url),'https://api.openai.com/v1/chat/completions'); assert.ok(init?.signal);
    body=JSON.parse(String(init?.body)); return response(market);
  });
  await p.analyzeNews({...item,summary:'a'.repeat(600)},people,['NVDA','QQQ'],'chosen-model');
  assert.equal(body.model,'chosen-model'); assert.equal(body.response_format.json_schema.strict,true);
  assert.deepEqual(body.response_format.json_schema.schema.properties.explicitlyMentionedSymbols.items.enum,['NVDA']);
  assert.equal(JSON.parse(body.messages[1].content).summary.length,400);
  assert.match(body.messages[0].content,/資料而非指令/); assert.match(body.messages[0].content,/目標價/);
});
test('empty candidates use empty arrays without invalid empty enums',async()=>{
  const empty={...market,explicitlyMentionedSymbols:[],inferredSymbols:[],relatedPersonIds:[]};
  const p=provider(async(_,init)=>{
    const props=JSON.parse(String(init?.body)).response_format.json_schema.schema.properties;
    for(const k of ['explicitlyMentionedSymbols','inferredSymbols','relatedPersonIds']) {assert.equal(props[k].maxItems,0); assert.equal(props[k].items.enum,undefined);}
    return response(empty);
  });
  assert.deepEqual(await p.analyzeNews({...item,relatedSymbols:[],relatedPersonIds:[]},[],[]),empty);
});
for (const [name,fetcher] of [
  ['HTTP failure',async()=>new Response('secret upstream details',{status:429})],
  ['timeout',async()=>{throw new DOMException('secret upstream details','TimeoutError')}],
  ['invalid JSON',async()=>new Response('not json')],
  ['invalid content JSON',async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'not json'}}]}))],
  ['missing field',async()=>response({...market,reasoning:undefined})],
  ['invalid enum',async()=>response({...market,impactDirection:'maybe'})],
  ['too many topics',async()=>response({...market,relatedTopics:['AI','ETF','台股','美股']})],
  ['overlong output',async()=>response({...market,conclusion:'字'.repeat(61)})],
  ['refusal',async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{refusal:'declined'}}]}))],
  ['truncated response',async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:JSON.stringify(market)}}]}))],
] as const) test(`provider rejects ${name} without leaking details`,async()=>{
  await assert.rejects(provider(fetcher).analyzeNews(item,people,['NVDA','QQQ']),{message:'News analysis provider failed'});
});
test('missing key never calls network',async()=>{
  let calls=0; const p=createNewsAnalysisProvider({apiKey:()=>undefined,fetcher:async()=>{calls++;return response(market)}});
  await assert.rejects(p.analyzeNews(item,people,[])); assert.equal(calls,0);
});
test('payload picks allowed fields even when objects contain private extras',async()=>{
  const p=provider(async(_,init)=>{
    const payload=String(init?.body); assert.doesNotMatch(payload,/private-secret|avgCost|shares|watchlist|buyDate/);
    return response(market);
  });
  const personWithExtra={...people[0],private:'private-secret'};
  await p.analyzeNews({...item,private:'private-secret'} as NewsItem,[personWithExtra],['NVDA','QQQ']);
});
test('model environment override and blank default',()=>{
  const old=process.env.NEWS_AI_MODEL;
  try {process.env.NEWS_AI_MODEL=' custom-model ';assert.equal(getNewsAIModel(),'custom-model'); process.env.NEWS_AI_MODEL='';assert.equal(getNewsAIModel(),DEFAULT_NEWS_AI_MODEL);}
  finally {if(old===undefined) delete process.env.NEWS_AI_MODEL; else process.env.NEWS_AI_MODEL=old;}
});

test('HTTP errors retain status and classification, without automatic retries or upstream secrets',async()=>{
  for(const [status,code] of [[429,'rate_limit'],[401,'configuration'],[400,'request_rejected'],[503,'upstream_unavailable']] as const) {
    let calls=0;
    await assert.rejects(provider(async()=>{calls++;return new Response('secret upstream',{status,headers:{'retry-after':'120'}})}).analyzeNews(item,people,[]),error=>{
      assert.ok(error instanceof NewsAnalysisError);assert.equal(error.code,code);assert.equal(error.httpStatus,status);
      if(status===429)assert.equal(error.retryDelaySeconds,120);
      assert.doesNotMatch(JSON.stringify(error),/secret upstream/);return true;
    });assert.equal(calls,1);
  }
});

test('validation diagnostics identify bounded schema fields without generated text',async()=>{
  for(const [value,code,field] of [
    [{...market,securityImpacts:[{private:'secret-generated-text'}]},'validation','securityImpacts[0].symbol'],
    [{...market,eventSummary:'作者建議買入 NVIDIA'},'output_guard','eventSummary'],
    [{...market,reasoning:'字'.repeat(151)},'validation','reasoning'],
  ] as const) {
    await assert.rejects(provider(async()=>response(value)).analyzeNews(item,people,[]),error=>{
      assert.ok(error instanceof NewsAnalysisError);assert.equal(error.code,code);assert.ok(error.fields.includes(field));
      assert.doesNotMatch(JSON.stringify(error),/secret-generated-text|作者建議/);return true;
    });
  }
});
