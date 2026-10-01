import type { Pool, PoolClient } from 'pg';

let serial=0;
const clients=new WeakMap<Pool,Set<PoolClient>>();
export function cloudTrace(step:string,pool?:Pool):void{
  if(process.env.SEC_PG_CLOUD_TRACE!=='1')return;
  process.stdout.write(`SEC_TEST ${step}${pool?` total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`:''}\n`);
}
/** Only emits an SQL verb, never SQL text/values/errors/connection options. */
export function observeCloudPool(pool:Pool):void{
  const id=++serial,seen=new WeakSet<PoolClient>(),tracked=new Set<PoolClient>();clients.set(pool,tracked);
  pool.on('connect',client=>{
    if(seen.has(client))return;seen.add(client);tracked.add(client);
    const query=client.query;
    client.query=new Proxy(query,{apply:(target,self,args)=>{
      const verb=typeof args[0]==='string'?/^[A-Z]+/.exec(args[0].trim())?.[0]??'OTHER':'OTHER';
      const start=Date.now();cloudTrace(`pool${id} query ${verb} before`,pool);
      const result=Reflect.apply(target,self,args);
      if(result instanceof Promise)return result.then(value=>{cloudTrace(`pool${id} query ${verb} after ms=${Date.now()-start}`,pool);return value;},error=>{cloudTrace(`pool${id} query ${verb} failed ms=${Date.now()-start}`,pool);throw error;});
      return result;
    }});
  });
  pool.on('acquire',()=>cloudTrace(`pool${id} acquire after`,pool));
  pool.on('release',()=>cloudTrace(`pool${id} release`,pool));
  pool.on('remove',client=>{tracked.delete(client);cloudTrace(`pool${id} remove`,pool);});
  pool.on('error',()=>cloudTrace(`pool${id} idle error`,pool));
  cloudTrace(`pool${id} created`,pool);
}

export async function endCloudPool(pool:Pool):Promise<void>{
  cloudTrace('pool.end before',pool);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const close=pool.end();
  try{
    await Promise.race([close,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
      cloudTrace('pool.end TIMEOUT',pool);
      for(const client of clients.get(pool)??[]){try{client.release(true);}catch{void client.end().catch(()=>{});}}
      reject(new Error('Cloud test pool shutdown timeout'));
    },30000);})]);
    cloudTrace('pool.end after',pool);
  }finally{if(timer)clearTimeout(timer);}
}
