import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAliasesInText } from './textMatch';
test('English aliases are case insensitive and whole words',()=>{
  assert.deepEqual(matchAliasesInText('SAID MAIN daily',{ai:['AI']}),[]);
  assert.deepEqual(matchAliasesInText('Investment in ai, NVIDIA.',{ai:['AI'],nvda:['nvidia']}),['ai','nvda']);
});
test('Chinese aliases match inside unsegmented sentences',()=>assert.deepEqual(matchAliasesInText('今天台積電公布資訊',{tsmc:['台積電']}),['tsmc']));
test('all matching ids returned once despite multiple matching aliases',()=>assert.deepEqual(matchAliasesInText('Trump and Donald Trump meet Jensen Huang',{trump:['Trump','Donald Trump'],huang:['Jensen Huang'],cook:['Tim Cook']}),['trump','huang']));
test('empty aliases and empty alias strings never match',()=>assert.deepEqual(matchAliasesInText('行政院發言代表與金管會代表',{executive:[],regulator:[],empty:['']}),[]));
test('no match and empty input return empty arrays',()=>{assert.deepEqual(matchAliasesInText('Markets',{powell:['Powell']}),[]);assert.deepEqual(matchAliasesInText('',{powell:['Powell']}),[])});
test('regex punctuation in C.C. Wei is literal',()=>{
  assert.deepEqual(matchAliasesInText('CXCX Wei',{wei:['C.C. Wei']}),[]);
  assert.deepEqual(matchAliasesInText('Remarks from c.c. wei today',{wei:['C.C. Wei']}),['wei']);
});
