'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, LayoutDashboard, Wallet, Star, ChartNoAxesCombined, ArrowUpRight } from 'lucide-react';
const links=[{href:'/dashboard',label:'市場總覽',icon:LayoutDashboard},{href:'/people',label:'關鍵人物',icon:Users},{href:'/portfolio',label:'我的投資組合',icon:Wallet},{href:'/watchlist',label:'觀察清單',icon:Star}];
export function Navigation(){const path=usePathname();return <><aside className="sidebar"><Link href="/dashboard" className="brand"><ChartNoAxesCombined size={27}/><span>拾光投資<small>個人投資情報站</small></span></Link><p className="nav-caption">投資工作台</p><nav aria-label="主要導覽">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} className={path===href?'active':''} aria-current={path===href?'page':undefined}><Icon size={19}/>{label}</Link>)}</nav><div className="sidebar-note"><span className="status-dot"/> 第一版 MVP<p>從市場脈動到你的投資配置，<br/>讓每日研究更有方向。</p><span>模擬資料模式 <ArrowUpRight size={14}/></span></div><div className="profile"><span className="avatar">我</span><div>個人工作空間<small>本地預覽 · 第一階段</small></div></div></aside><nav className="mobile-nav" aria-label="手機導覽">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} className={path===href?'active':''} aria-current={path===href?'page':undefined}><Icon size={20}/>{label}</Link>)}</nav></>}

