'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createFollowingRepository,FOLLOWING_KEY,type FollowingState} from '@/lib/services/followingRepository';

const initial:FollowingState={snapshot:{version:1,records:[]},warning:null};
const Context=createContext({state:initial,ready:false,setFollowed:(_id:string,_followed:boolean)=>{}});
export function FollowingProvider({children}:{children:ReactNode}) {
  const repository=useRef<ReturnType<typeof createFollowingRepository>|null>(null);
  const [state,setState]=useState(initial),[ready,setReady]=useState(false);
  useEffect(()=>{
    const repo=createFollowingRepository(()=>window.localStorage);repository.current=repo;
    setState(repo.read());setReady(true);
    const sync=(event:StorageEvent)=>{if(event.key===FOLLOWING_KEY || event.key===null) setState(repo.refresh());};
    window.addEventListener('storage',sync);return ()=>window.removeEventListener('storage',sync);
  },[]);
  return <Context.Provider value={{state,ready,setFollowed:(id,followed)=>{if(repository.current)setState(repository.current.setFollowed(id,followed));}}}>{children}</Context.Provider>;
}
export const useFollowing=()=>useContext(Context);
export function FollowButton({id,name}:{id:string;name:string}) {
  const {state,ready,setFollowed}=useFollowing();const followed=state.snapshot.records.some(r=>r.entityId===id);
  return <button className="intelligence-follow" disabled={!ready} aria-label={`${followed?'取消追蹤':'追蹤'} ${name}`} aria-pressed={followed} onClick={()=>setFollowed(id,!followed)}>{!ready?'載入追蹤狀態…':followed?'已追蹤 · Following':'＋ 追蹤 · Follow'}</button>;
}
export function FollowingNotice() {
  const {state}=useFollowing();
  return <><p className="muted">追蹤清單僅存於此瀏覽器，清除網站資料會遺失；不會送給 AI，也不代表持有該人物或機構關聯的股票。</p>{state.warning&&<p role="status" className="scenario-note">{state.warning}</p>}</>;
}
