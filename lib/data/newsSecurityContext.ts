/** Bounded qualitative context, not live ETF constituents, weights or financial data.
 * Unsupported links are deliberately omitted. Revisit when tracked securities change.
 */
export const newsSecurityContext:Record<string,{name:string;region:string;industry:string;exposure:string}> = {
  '2330':{name:'台積電',region:'台灣',industry:'晶圓代工',exposure:'半導體製造、全球客戶需求'},
  '2317':{name:'鴻海',region:'台灣',industry:'電子製造',exposure:'電子產品組裝需求'},
  '0050':{name:'元大台灣50',region:'台灣',industry:'ETF',exposure:'臺灣50指數；不提供即時成分或權重'},
  '^TWII':{name:'加權指數',region:'台灣',industry:'市場指數',exposure:'台灣上市股票市場'},
  NVDA:{name:'NVIDIA',region:'美國',industry:'晶片設計',exposure:'運算晶片需求'},
  AAPL:{name:'Apple',region:'美國',industry:'消費電子',exposure:'終端裝置需求'},
  MSFT:{name:'Microsoft',region:'美國',industry:'軟體與雲端',exposure:'企業軟體與雲端需求'},
  QQQ:{name:'Invesco QQQ',region:'美國',industry:'ETF',exposure:'NASDAQ-100指數；不提供即時成分或權重'},
  SPY:{name:'SPDR S&P 500 ETF',region:'美國',industry:'ETF',exposure:'S&P 500指數；不提供即時成分或權重'},
  VOO:{name:'Vanguard S&P 500 ETF',region:'美國',industry:'ETF',exposure:'S&P 500指數；不提供即時成分或權重'},
};
// Potential supply-chain channels, not evidence that this particular news affects them.
export const supplyChainLinks:Record<string,string[]>={NVDA:['2330'],AAPL:['2330','2317']};
