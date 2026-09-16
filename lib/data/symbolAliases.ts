/** Keywords used to detect which tracked security a real news item mentions. */
export const symbolAliases: Record<string, string[]> = {
  '0050': ['0050', '元大台灣50'],
  '2330': ['2330', 'TSMC', 'Taiwan Semiconductor', '台積電'],
  '2317': ['2317', 'Foxconn', 'Hon Hai', '鴻海'],
  AAPL: ['AAPL', 'Apple', '蘋果'],
  NVDA: ['NVDA', 'NVIDIA', '輝達', 'Nvidia'],
  VOO: ['VOO'],
  QQQ: ['QQQ'],
  SPY: ['SPY'],
  MSFT: ['MSFT', 'Microsoft', '微軟'],
  '^TWII': ['加權指數', '台股大盤', 'TAIEX'],
};
