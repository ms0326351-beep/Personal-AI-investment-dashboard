import { marketDataService } from '@/lib/services/marketDataService';
import { watchlistRepository } from '@/lib/services/watchlistRepository';
import { Card,SecurityList } from '@/components/ui/common';
export default async function Watchlist(){const [all,symbols]=await Promise.all([marketDataService.getSecurities(),watchlistRepository.getSymbols()]);return <><div className="page-heading"><div><p className="eyebrow">持續關注，從容研究</p><h1>觀察清單</h1><p className="muted">點選標的查看研究頁。第一階段提供模擬清單，新增與移除留待下一階段。</p></div></div><Card title={`關注中的標的 · ${symbols.length} 檔`}><SecurityList securities={symbols.map(s=>all.find(q=>q.symbol===s)!).filter(Boolean)}/></Card></>}
