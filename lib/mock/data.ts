import type { Security, MarketIndex, Holding, NewsItem, MarketEvent, MarketCommentary } from '@/lib/types';
export const updatedAt = '2026-09-10T13:30:00+08:00';
export const securities: Security[] = [
  ['0050','元大台灣50','TW','etf','TWD',62.85,0.75,'台灣大型股',2.4],
  ['2330','台積電','TW','stock','TWD',1080,15,'半導體',1.7],
  ['2317','鴻海','TW','stock','TWD',198.5,-2.5,'電子製造',2.9],
  ['AAPL','蘋果','US','stock','USD',232.8,2.1,'消費電子',0.4],
  ['NVDA','輝達','US','stock','USD',142.6,3.2,'半導體',0.03],
  ['VOO','Vanguard 標普500 ETF','US','etf','USD',532.4,3.7,'美國大型股',1.3],
  ['QQQ','Invesco 那斯達克100 ETF','US','etf','USD',498.2,-2.4,'科技成長股',0.6],
  ['SPY','SPDR 標普500 ETF','US','etf','USD',564.2,3.6,'美國大型股',1.2],
  ['MSFT','微軟','US','stock','USD',425.5,2.5,'軟體與雲端',0.7],
  ['^TWII','台灣加權指數','TW','index','TWD',23458.32,268.45,'台灣股票市場',0],
].map(([symbol,name,market,type,currency,price,change,sector,dividendYield]) => ({symbol,name,market,type,currency,price,change,sector,dividendYield,updatedAt,changePercent: Number(change)/(Number(price)-Number(change))*100}) as Security);
export const indices: MarketIndex[] = [
  ['TAIEX','加權指數','TW',23458.32,268.45],['TPEX','櫃買指數','TW',256.78,-1.23],['SP500','S&P 500','US',5648.4,42.16],['NASDAQ','那斯達克','US',17890.2,186.3],['DOW','道瓊工業','US',41265.8,-82.4],
].map(([code,name,market,value,change]) => ({code,name,market,value,change,changePercent:Number(change)/(Number(value)-Number(change))*100,updatedAt}) as MarketIndex);
export const holdings: Holding[] = [{id:'1',symbol:'0050',shares:4000,avgCost:54,buyDate:'2026-01-05'},{id:'2',symbol:'2330',shares:200,avgCost:950,buyDate:'2026-02-10'},{id:'3',symbol:'VOO',shares:15,avgCost:490,buyDate:'2026-03-02'},{id:'4',symbol:'AAPL',shares:20,avgCost:220,buyDate:'2026-04-08'}];
export const watchlist = ['0050','NVDA','AAPL','QQQ','2317'];
export const fx = { TWD: 1, USD: 32 };
export const commentary: MarketCommentary = {date:'2026-09-10',headline:'科技股領軍，台美市場動能延續',reasons:['台灣半導體權值股走強，帶動加權指數收紅。','美股科技板塊表現相對強勢，市場關注 AI 需求。','通膨與利率前景仍是焦點，留意後續數據變化。'],disclaimer:'AI 生成內容，僅供參考，非投資建議。本頁為預寫模擬範例，尚未串接 AI。'};
export const news: NewsItem[] = [
  ['半導體買盤回溫，台股權值股領漲','資金聚焦大型科技股，電子族群成為盤面焦點。',['2330','0050']],
  ['美股科技板塊走強，AI 需求受關注','投資人持續觀察企業資本支出與獲利展望。',['NVDA','QQQ']],
  ['大型 ETF 成為資產配置焦點','分散布局仍須留意成分股集中度與市場波動。',['0050','VOO']],
  ['市場靜待通膨數據，利率前景待觀察','數據變化可能影響美元及風險性資產表現。',['VOO']],
  ['消費電子需求展望受市場關注','供應鏈庫存及新品銷售將是後續觀察重點。',['AAPL','2317']],
].map(([title,summary,relatedSymbols],i)=>({id:String(i),title,summary,relatedSymbols,source:'模擬市場編輯室',publishedAt:`2026-09-10T${String(12-i).padStart(2,'0')}:00:00+08:00`}) as NewsItem);
export const events: MarketEvent[] = [{date:'09/11',title:'美國通膨數據觀察',market:'美股',importance:'高'},{date:'09/16',title:'利率決策前瞻',market:'美股',importance:'高'},{date:'09/18',title:'ETF 成分調整觀察',market:'台股',importance:'中'}];
