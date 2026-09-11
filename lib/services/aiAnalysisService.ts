import type { MarketCommentary, AIAnalysis } from '@/lib/types';
import { commentary } from '@/lib/mock/data';
export interface AIAnalysisService { getMarketCommentary(): Promise<MarketCommentary>; getAnalysis(symbol:string): Promise<AIAnalysis> }
export const mockAIAnalysisService: AIAnalysisService = {async getMarketCommentary(){return commentary},async getAnalysis(symbol){return {symbol,summary:`${symbol} 的示範研究摘要：觀察成分產業的獲利趨勢，並搭配自身資產配置與風險承受度評估。`,bullFactors:['產業長期需求提供成長空間','獲利改善可能支持市場評價'],bearFactors:['市場評價偏高時可能放大修正','景氣變化可能影響企業獲利'],riskAlerts:['歷史表現不代表未來報酬。','留意市場波動、產業集中與匯率風險。'],disclaimer:commentary.disclaimer}}};
export const aiAnalysisService: AIAnalysisService = mockAIAnalysisService;
