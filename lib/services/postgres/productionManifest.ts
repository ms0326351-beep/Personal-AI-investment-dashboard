import 'server-only';
import { readFile } from 'node:fs/promises';
import { migrationChecksum, type SecMigration } from './migrationRunner';

export interface ProductionManifestEntry {
  id:string; version:number; filename:string; sha256:string; order:number;
  purpose:string; minimumPostgresVersion:number; transactional:true;
  dependencies:string[]; productionApplicable:true;
}
export function validateProductionManifest(input:unknown):ProductionManifestEntry[] {
  if(!input||typeof input!=='object'||!('schemaVersion'in input)||input.schemaVersion!=='sec-production-manifest-v1'||!('migrations'in input)||!Array.isArray(input.migrations)||!input.migrations.length)throw Error('Invalid production manifest');
  const seen=new Set<string>();
  return input.migrations.map((x:unknown,i:number)=>{
    if(!x||typeof x!=='object')throw Error('Invalid manifest entry');
    const m=x as Partial<ProductionManifestEntry>;
    if(typeof m.id!=='string'||!/^[a-z][a-z0-9_]+$/.test(m.id)||seen.has(m.id)||m.version!==i+1||m.order!==i+1||
      typeof m.filename!=='string'||!/^\d{3}_[a-z0-9_]+\.sql$/.test(m.filename)||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||
      typeof m.purpose!=='string'||!m.purpose.trim()||!Number.isInteger(m.minimumPostgresVersion)||Number(m.minimumPostgresVersion)<18||
      m.transactional!==true||m.productionApplicable!==true||!Array.isArray(m.dependencies)||m.dependencies.some(d=>typeof d!=='string'||!seen.has(d)))throw Error('Invalid manifest entry');
    seen.add(m.id);return m as ProductionManifestEntry;
  });
}
export function verifyProductionArtifact(entry:ProductionManifestEntry,sql:string):void {
  if(migrationChecksum(sql)!==entry.sha256||/local\/test|rehearsal.only|fixture.only|reset.only/i.test(sql))throw Error('Production migration artifact refused');
}
/** Fixed reviewed directory; never scans folders or accepts user SQL paths. */
export async function loadProductionMigrations():Promise<{entries:ProductionManifestEntry[];migrations:SecMigration[]}> {
  const entries=validateProductionManifest(JSON.parse(await readFile(new URL('./production/manifest.v1.json',import.meta.url),'utf8')));
  const migrations=[];
  for(const e of entries){const sql=await readFile(new URL('./production/'+e.filename,import.meta.url),'utf8');
    verifyProductionArtifact(e,sql);
    migrations.push({version:e.version,name:e.id,sql});}
  return {entries,migrations};
}
