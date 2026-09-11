import type { KeyPerson, PersonEvent, DayTimelineEntry } from '@/lib/types/people';

// All roles, statements and schedules below belong to a fictional scenario.
export const peopleDate = '2026-09-10';
export const peopleTime = '13:30';
export const people: Omit<KeyPerson, 'currentImpactLevel'>[] = [
  {id:'jensen-huang',name:'黃仁勳',title:'企業領袖',organization:'NVIDIA',category:'corporate_leader',relatedSymbols:['NVDA','2330','0050']},
  {id:'jerome-powell',name:'鮑爾',title:'貨幣政策人物',organization:'Fed 情境',category:'central_bank',relatedSymbols:['QQQ','VOO','AAPL']},
  {id:'donald-trump',name:'川普',title:'美國政治人物',organization:'美國政策情境',category:'us_politics',relatedSymbols:['2330','0050','AAPL']},
  {id:'tim-cook',name:'庫克',title:'企業領袖',organization:'Apple',category:'corporate_leader',relatedSymbols:['AAPL','2317']},
  {id:'cc-wei',name:'魏哲家',title:'企業領袖',organization:'台積電',category:'corporate_leader',relatedSymbols:['2330','0050']},
  {id:'elon-musk',name:'馬斯克',title:'企業領袖',organization:'電動車與科技產業情境',category:'corporate_leader',relatedSymbols:[]},
  {id:'tw-executive',name:'行政院發言代表',title:'政策發言窗口',organization:'台灣行政院情境',category:'tw_politics',relatedSymbols:['0050','2317']},
  {id:'tw-regulator',name:'金管會代表',title:'金融監理窗口',organization:'台灣金融監理情境',category:'regulator',relatedSymbols:['0050']},
];
export const personEvents: PersonEvent[] = [
  {id:'huang-demand',personId:'jensen-huang',occurredAt:'2026-09-10T11:00:00+08:00',headline:'示例：談 AI 運算需求，供應鏈成為觀察焦點',impactDirection:'bullish',impactLevel:'high',affectedMarkets:['AI','半導體','台股','美股'],affectedSymbols:['NVDA','2330','0050']},
  {id:'powell-rates',personId:'jerome-powell',occurredAt:'2026-09-10T08:00:00+08:00',headline:'示例：政策展望偏審慎，市場重估利率路徑',impactDirection:'bearish',impactLevel:'high',affectedMarkets:['利率','美股'],affectedSymbols:['QQQ','VOO','AAPL']},
  {id:'trump-trade',personId:'donald-trump',occurredAt:'2026-09-10T10:00:00+08:00',headline:'示例：貿易政策討論，增加半導體供應鏈不確定性',impactDirection:'bearish',impactLevel:'high',affectedMarkets:['半導體','台股','美股'],affectedSymbols:['2330','0050','AAPL']},
  {id:'cook-products',personId:'tim-cook',occurredAt:'2026-09-10T09:30:00+08:00',headline:'示例：產品需求展望帶動消費電子關注',impactDirection:'bullish',impactLevel:'medium',affectedMarkets:['消費電子','美股'],affectedSymbols:['AAPL','2317']},
  {id:'wei-capacity',personId:'cc-wei',occurredAt:'2026-09-10T12:00:00+08:00',headline:'示例：先進製程需求展望支持產業信心',impactDirection:'bullish',impactLevel:'high',affectedMarkets:['半導體','台股'],affectedSymbols:['2330','0050']},
  {id:'musk-outlook',personId:'elon-musk',occurredAt:'2026-09-10T07:00:00+08:00',headline:'示例：討論電動車市場競爭與研發方向',impactDirection:'neutral',impactLevel:'low',affectedMarkets:['電動車'],affectedSymbols:[]},
  {id:'tw-policy',personId:'tw-executive',occurredAt:'2026-09-10T09:00:00+08:00',headline:'示例：產業政策說明，關注企業投資環境',impactDirection:'neutral',impactLevel:'medium',affectedMarkets:['台股'],affectedSymbols:['0050','2317']},
  {id:'tw-market',personId:'tw-regulator',occurredAt:'2026-09-10T08:30:00+08:00',headline:'示例：市場監理說明，提醒投資人留意波動',impactDirection:'neutral',impactLevel:'low',affectedMarkets:['金融','台股'],affectedSymbols:['0050']},
];
export const dayTimeline: DayTimelineEntry[] = [
  {id:'open',time:'09:00',label:'台股開盤觀察',category:'market_open',importance:'medium',relatedPersonIds:[],relatedSymbols:['0050','2330','2317'],impactReason:'開盤資金流向可能影響台灣權值股與大盤 ETF。'},
  {id:'trade',time:'10:00',label:'貿易政策討論',category:'policy',importance:'high',relatedPersonIds:['donald-trump'],relatedSymbols:['2330','0050','AAPL'],impactReason:'政策不確定性 → 供應鏈成本與需求預期改變 → 半導體及消費電子標的。'},
  {id:'ai',time:'11:00',label:'AI 需求展望談話',category:'earnings',importance:'high',relatedPersonIds:['jensen-huang'],relatedSymbols:['NVDA','2330','0050'],impactReason:'AI 運算需求 → 晶片與先進製程需求 → 輝達、台積電及相關 ETF。'},
  {id:'fed',time:'14:00',label:'貨幣政策談話',category:'fed_speech',importance:'high',relatedPersonIds:['jerome-powell'],relatedSymbols:['QQQ','VOO','AAPL'],impactReason:'利率預期變化 → 企業估值折現率變化 → 美股與成長型 ETF。'},
  {id:'cpi',time:'20:30',label:'美國通膨數據觀察',category:'economic_data',importance:'high',relatedPersonIds:[],relatedSymbols:['VOO','QQQ'],impactReason:'通膨數據 → 市場重估利率路徑 → 美股大盤與科技類 ETF。'},
  {id:'demand',time:'22:00',label:'美國消費數據觀察',category:'economic_data',importance:'medium',relatedPersonIds:[],relatedSymbols:['AAPL','2317'],impactReason:'消費需求變化 → 電子產品銷售預期 → 品牌商與供應鏈。'},
];
