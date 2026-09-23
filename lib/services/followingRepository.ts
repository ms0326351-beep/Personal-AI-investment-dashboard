import type { FollowSnapshot } from '../types/publicIntelligence';
export const FOLLOWING_KEY='investment-intelligence:following:v1';
export interface FollowingStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface FollowingState {snapshot:FollowSnapshot; warning:string|null}
const empty=():FollowSnapshot=>({version:1,records:[]});
export function parseFollowing(raw:string|null):FollowSnapshot {
  if(raw===null) return empty();
  const value=JSON.parse(raw) as FollowSnapshot;
  if(value?.version!==1 || !Array.isArray(value.records) || value.records.length>1000) throw new Error('Invalid following version');
  const seen=new Set<string>();
  for(const r of value.records) {
    if(!r || typeof r.entityId!=='string' || !r.entityId || r.entityId.length>200 || typeof r.followedAt!=='string' || !Number.isFinite(Date.parse(r.followedAt)) || seen.has(r.entityId)) throw new Error('Invalid following record');
    seen.add(r.entityId);
  }
  return {version:1,records:value.records.map(({entityId,followedAt})=>({entityId,followedAt}))};
}
/** Preferences only. No holdings, secrets, provider requests or AI calls. */
export function createFollowingRepository(storage:()=>FollowingStorage,now=()=>new Date().toISOString()) {
  let state:FollowingState={snapshot:empty(),warning:null};
  let volatile=false;
  const copy=()=>structuredClone(state);
  return {
    read():FollowingState {
      if(volatile) return copy();
      try {state={snapshot:parseFollowing(storage().getItem(FOLLOWING_KEY)),warning:null};}
      catch {state={...state,warning:'追蹤資料無法讀取或格式不相容；原始資料不會被覆寫。'};}
      return copy();
    },
    setFollowed(entityId:string,followed:boolean):FollowingState {
      const read=this.read();
      if(read.warning && !volatile) return read;
      if(!entityId || entityId.length>200) return {...read,warning:'無效的追蹤識別碼。'};
      const records=read.snapshot.records.filter(r=>r.entityId!==entityId);
      const old=read.snapshot.records.find(r=>r.entityId===entityId);
      if(followed) records.push(old ?? {entityId,followedAt:now()});
      if(records.length>1000) return {...read,warning:'已達本機追蹤清單上限。'};
      state={snapshot:{version:1,records},warning:null};
      try {storage().setItem(FOLLOWING_KEY,JSON.stringify(state.snapshot));volatile=false;}
      catch {volatile=true;state.warning='無法寫入本機儲存；本次追蹤只保留到離開此頁，重新整理可能遺失。';}
      return copy();
    },
    refresh():FollowingState {if(!volatile) return this.read();return copy();},
  };
}
