import 'server-only';

// Never retain upstream bodies, headers, exception messages or generated text.
export class NewsAnalysisError extends Error {
  constructor(public readonly code: string, public readonly userMessage: string,
    public readonly httpStatus?: number, public readonly fields: string[] = [],
    public readonly retryDelaySeconds = 30) {
    super('News analysis provider failed');
  }
}

export function classifyAnalysisError(error: unknown): NewsAnalysisError {
  if(error instanceof NewsAnalysisError) return error;
  const name=error instanceof Error ? error.name : '';
  if(name==='TimeoutError' || name==='AbortError') return new NewsAnalysisError('timeout','AI 分析等待逾時，請稍後重試');
  if(name==='SyntaxError') return new NewsAnalysisError('invalid_json','AI 回傳的資料格式不完整，請稍後重試');
  if(name==='TypeError') return new NewsAnalysisError('connection','AI 服務連線失敗，請稍後重試');
  return new NewsAnalysisError('internal','分析處理發生錯誤，請稍後重試；若持續發生請檢查伺服器紀錄');
}

export function providerHttpError(status: number, retryAfter: string|null): NewsAnalysisError {
  if(status===429) {
    const seconds=retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : retryAfter ? Math.ceil((Date.parse(retryAfter)-Date.now())/1000) : 60;
    return new NewsAnalysisError('rate_limit','AI 服務目前限流或額度不足，請稍後重試；持續發生時請檢查服務額度',status,[],Math.max(60,Number.isFinite(seconds)?seconds:60));
  }
  if(status===401 || status===403) return new NewsAnalysisError('configuration','AI 服務授權失敗，請檢查伺服器設定',status,[],900);
  if(status>=500) return new NewsAnalysisError('upstream_unavailable','AI 上游服務暫時異常，請稍後重試',status);
  return new NewsAnalysisError('request_rejected','AI 服務拒絕分析請求，請檢查模型與請求設定',status,[],900);
}
