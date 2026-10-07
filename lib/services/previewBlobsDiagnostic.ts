import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDeployStore } from '@netlify/blobs';
import { createNewsBlobFetch } from './news/newsBlobStore';

type Store={
  setJSON(key:string,value:unknown,conditions:{onlyIfNew:true}|{onlyIfMatch:string}):Promise<{modified:boolean}>;
  getWithMetadata(key:string,options:{type:'json';consistency:'strong'}):Promise<{data:unknown;etag?:string}|null>;
  delete(key:string):Promise<void>;
};
type Config={context?:string;enabled?:string;token?:string;url?:string};
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);};
const sign=(value:string,token:string)=>createHmac('sha256',token).update(value).digest('hex');
const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createPreviewBlobsDiagnostic(
  config:()=>Config=()=>({context:process.env.PREVIEW_DIAGNOSTIC_BUILD_CONTEXT,enabled:process.env.PREVIEW_BLOBS_DIAGNOSTICS_ENABLED,token:process.env.PREVIEW_BLOBS_DIAGNOSTIC_TOKEN,url:process.env.PREVIEW_DIAGNOSTIC_BUILD_URL}),
  storeFactory:()=>Store=()=>getDeployStore({name:'preview-blobs-diagnostic',consistency:'strong',fetch:createNewsBlobFetch()}),
  fetcher:typeof fetch=fetch,
  log:(fields:Record<string,string|boolean|number|null>)=>void=fields=>console.warn(JSON.stringify(fields)),
) {
  return async function POST(request:Request):Promise<Response> {
    const c=config();
    const header=request.headers.get('X-Preview-Diagnostic-Token');
    const tokenMatch=Boolean(c.token)&&equal(header??'',c.token??'');
    if(c.context!=='deploy-preview'||c.enabled!=='true'||!c.token||c.token.length<32||!tokenMatch) {
      // Allowlisted metadata only: never serialize config, request or secret values.
      try {log({event:'preview_blobs_gate_denied',context:c.context===undefined?null:['production','deploy-preview','branch-deploy','dev'].includes(c.context)?c.context:'unknown',
        contextOk:c.context==='deploy-preview',enabledPresent:typeof c.enabled==='string',enabledOk:c.enabled==='true',
        envTokenPresent:Boolean(c.token),envTokenLength:c.token?.length??0,headerPresent:Boolean(header),headerLength:header?.length??0,tokenMatch});} catch { /* Logging must not change fail-closed behavior. */ }
      return respond({status:'DENIED'},403);
    }
    if(request.body!==null||new URL(request.url).search) {
      const length=request.headers.get('content-length');
      const numericLength=length!==null&&/^\d{1,15}$/.test(length)&&Number.isSafeInteger(Number(length))?Number(length):null;
      try {log({event:'preview_blobs_invalid_request',method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(request.method)?request.method:'OTHER',
        urlHasQuery:Boolean(new URL(request.url).search),bodyIsNull:request.body===null,
        contentLengthPresent:request.headers.has('content-length'),contentLength:numericLength,
        contentTypePresent:request.headers.has('content-type'),transferEncodingPresent:request.headers.has('transfer-encoding')});} catch { /* Logging cannot alter validation. */ }
      return respond({status:'INVALID_REQUEST'},400);
    }
    const receipt=request.headers.get('X-Preview-Diagnostic-Receipt');
    if(receipt) {
      const [run,expires,signature,...extra]=receipt.split('.');
      if(extra.length||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(run)||!/^\d+$/.test(expires)||Number(expires)<Date.now()||Number(expires)>Date.now()+60000||!signature||!equal(sign(`${run}.${expires}`,c.token),signature)) return respond({status:'DENIED'},403);
      try {
        const read=await storeFactory().getWithMetadata(`preview-diagnostic/${run}/create`,{type:'json',consistency:'strong'});
        return respond({persisted:!!read&&!!read.data&&typeof read.data==='object'&&'marker' in read.data&&read.data.marker==='preview-diagnostic'});
      } catch {return respond({status:'STORAGE_UNAVAILABLE'},503);}
    }
    let target:URL;
    try {
      target=new URL(c.url??'');
      if(target.protocol!=='https:'||!/^deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/.test(target.hostname)||target.username||target.password||target.port||target.origin!==new URL(request.url).origin) throw Error();
      target.pathname='/api/diagnostics/blobs';target.search='';target.hash='';
    } catch {return respond({status:'INVALID_PREVIEW_TARGET'},503);}
    const run=randomUUID(),keys=['create','cas','race'].map(k=>`preview-diagnostic/${run}/${k}`);
    const data=(revision:number)=>({marker:'preview-diagnostic',nonce:randomUUID(),revision,timestamp:new Date().toISOString()});
    const results:Record<string,boolean>={};let failed=false;let cleanup=true;let store:Store|undefined;
    try {
      store=storeFactory();
      results.create=(await store.setJSON(keys[0],data(0),{onlyIfNew:true})).modified===true;
      results.createConflict=(await store.setJSON(keys[0],data(1),{onlyIfNew:true})).modified===false;
      await store.setJSON(keys[1],data(0),{onlyIfNew:true});
      const old=await store.getWithMetadata(keys[1],{type:'json',consistency:'strong'});
      if(!old?.etag) throw Error();
      results.cas=(await store.setJSON(keys[1],data(1),{onlyIfMatch:old.etag})).modified===true;
      results.casConflict=(await store.setJSON(keys[1],data(2),{onlyIfMatch:`invalid-${randomUUID()}`})).modified===false;
      const race=await Promise.all([store.setJSON(keys[2],data(0),{onlyIfNew:true}),store.setJSON(keys[2],data(0),{onlyIfNew:true})]);
      results.race=race.filter(r=>r.modified===true).length===1&&race.filter(r=>r.modified===false).length===1;
      const value=`${run}.${Date.now()+60000}`;
      const response=await fetcher(target,{method:'POST',headers:{'X-Preview-Diagnostic-Token':c.token,'X-Preview-Diagnostic-Receipt':`${value}.${sign(value,c.token)}`},signal:AbortSignal.timeout(10000),redirect:'error'});
      const read:unknown=await response.json();
      results.crossRequest=response.ok&&!!read&&typeof read==='object'&&'persisted' in read&&read.persisted===true;
    } catch {failed=true;}
    finally {
      if(store) {const removed=await Promise.allSettled(keys.map(k=>store!.delete(k)));cleanup=removed.every(r=>r.status==='fulfilled');}
    }
    const pass=!failed&&cleanup&&Object.keys(results).length===6&&Object.values(results).every(Boolean);
    return respond({status:pass?'PASS':'FAILED',context:'deploy-preview',classification:'deploy-specific',store:'deploy-scoped diagnostic store',runId:run,results,cleanup},pass?200:503);
  };
}
