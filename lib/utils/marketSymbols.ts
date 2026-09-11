export function normalizeSymbol(symbol:string):string {
  let decoded=symbol;
  try { decoded=decodeURIComponent(symbol); } catch { return ''; }
  return decoded.trim().toUpperCase().replace(/^(0050|2330|2317)\.TW$/, '$1');
}
