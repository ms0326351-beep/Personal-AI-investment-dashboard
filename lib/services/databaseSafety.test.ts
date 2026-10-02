import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertDatabaseIdentity, assertTestEndpoint, testDatabaseTarget } from './postgres/databaseSafety';
import { runtimeDatabaseConfig,createRuntimeDatabase } from './postgres/runtimeDatabase';
import { migrationConnection } from './postgres/migrationConnection';
import { migrationChecksum } from './postgres/migrationRunner';

const id='11111111-2222-3333-4444-555555555555';
const target={environment:'test' as const,databaseInstanceId:id,databaseName:'validation'};
const identity={environment:'test',databaseInstanceId:id,createdAt:'2026-10-02T00:00:00Z'};
for(const environment of ['test','development'] as const)test(`guard permits matched ${environment}`,()=>{
  assertDatabaseIdentity({...target,environment},{...identity,environment},'validation',true);
});
for(const [name,marker] of [
  ['production',{...identity,environment:'production'}],['missing',null],['malformed',{}],
  ['wrong UUID',{...identity,databaseInstanceId:'invalid'}],['wrong date',{...identity,createdAt:null}],
  ['environment mismatch',{...identity,environment:'development'}],
] as const)test(`guard refuses ${name} marker`,()=>assert.throws(()=>assertDatabaseIdentity(target,marker,'validation',true),/refused/));
test('production cleanup is refused even when target and marker agree',()=>assert.throws(()=>assertDatabaseIdentity({...target,environment:'production'},{...identity,environment:'production'},'validation',true)));
test('migration production target mismatch fails',()=>assert.throws(()=>assertDatabaseIdentity({...target,environment:'production'},identity,'validation')));
test('database name mismatch fails',()=>assert.throws(()=>assertDatabaseIdentity(target,identity,'other',true)));
test('unknown application environment fails before connecting',()=>assert.throws(()=>testDatabaseTarget({DATABASE_ENV:'unknown'})));
test('production application marker refuses test bootstrap',()=>assert.throws(()=>testDatabaseTarget({DATABASE_ENV:'production'})));
// Synthetic URL constructed in-memory; never a fixture or real credential.
const connection=(pooled:boolean)=>new URL('/validation',`postgresql://${pooled?'fixture-pooler':'fixture'}.invalid`).toString();
const env={DATABASE_ENV:'test',SEC_PG_EXPECTED_INSTANCE_ID:id,SEC_PG_EXPECTED_DATABASE:'validation',SEC_PG_ALLOWED_HOSTS:'fixture.invalid'};
test('exact test endpoint accepts allowlisted database',()=>assert.doesNotThrow(()=>assertTestEndpoint(connection(false),env)));
test('other host is refused before connection',()=>assert.throws(()=>assertTestEndpoint(connection(true),env)));
test('other database is refused before connection',()=>assert.throws(()=>assertTestEndpoint(connection(false),{...env,SEC_PG_EXPECTED_DATABASE:'other'})));
test('connection query cannot override allowlisted host',()=>{
  const url=new URL(connection(false));url.searchParams.set('host','other.invalid');assert.throws(()=>assertTestEndpoint(url.toString(),env));
});
test('production owner cannot be used by runtime factory',()=>{
  const url=new URL(connection(true));url.username='neondb_owner';url.password='synthetic';
  assert.throws(()=>runtimeDatabaseConfig({DATABASE_ENV:'production',DATABASE_URL:url.toString(),DB_EXPECTED_INSTANCE_ID:id}));
});
test('migration checksum detects byte changes deterministically',()=>{assert.equal(migrationChecksum('SELECT 1'),migrationChecksum('SELECT 1'));assert.notEqual(migrationChecksum('SELECT 1'),migrationChecksum('SELECT 1;'));});
test('runtime refuses migration-only credential without fallback',()=>assert.throws(()=>runtimeDatabaseConfig({DATABASE_ENV:'test',DATABASE_DIRECT_URL:connection(false)})));
test('migration refuses runtime-only credential without fallback',()=>assert.throws(()=>migrationConnection({DATABASE_ENV:'test',DATABASE_URL:connection(true)})));
test('runtime and migration error messages never include rejected URL',()=>{
  const secret='DO_NOT_LOG_SYNTHETIC_SENTINEL';
  for(const fn of [()=>runtimeDatabaseConfig({DATABASE_ENV:'test',DATABASE_URL:secret}),()=>migrationConnection({DATABASE_ENV:'test',DATABASE_DIRECT_URL:secret})]){
    assert.throws(fn,e=>e instanceof Error && !e.message.includes(secret));
  }
});
test('runtime defaults are conservative and configuration is bounded',()=>{
  const url=new URL(connection(true));url.username='fixture';url.password='synthetic';
  const input={DATABASE_ENV:'test',DATABASE_URL:url.toString(),DB_EXPECTED_INSTANCE_ID:id};
  const config=runtimeDatabaseConfig(input);assert.equal(config.options.max,2);assert.equal(config.options.ssl.rejectUnauthorized,true);
  assert.equal(config.options.connectionTimeoutMillis,10000);assert.equal(config.options.query_timeout,15000);
  assert.throws(()=>runtimeDatabaseConfig({...input,DB_POOL_MAX:'100'}));
});
test('factory is lazy with invalid environment until first explicit acquisition',async()=>{
  const factory=createRuntimeDatabase({});await factory.close();await assert.rejects(factory.getPool(),/refused/);
});
test('runtime architecture does not import admin credential getter',async()=>{
  const source=await readFile(new URL('./postgres/runtimeDatabase.ts',import.meta.url),'utf8');
  assert.equal(/migrationConnection|DATABASE_DIRECT_URL/.test(source),false);
  assert.match(source,/import 'server-only'/);
});
