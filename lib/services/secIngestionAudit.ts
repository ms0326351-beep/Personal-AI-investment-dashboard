import 'server-only';
import type { SecIngestionAttempt, SecIngestionAudit } from '../types/secIngestion';
import { validateSecMetadata } from '../utils/secEndpoints';

/** Shared safe field selection; no storage side effects. */
export function safeSecIngestionAttempt(input: SecIngestionAttempt): SecIngestionAttempt {
    const metadata=validateSecMetadata(input.metadata);
    const code=(value:string)=> /^[A-Za-z0-9_]+$/.test(value);
    if (input.accessionNumber!==metadata.accessionNumber || !Number.isFinite(Date.parse(input.attemptedAt)) ||
      input.warnings.some(w=>!code(w)) || (input.failure && !code(input.failure.code)) ||
      [input.rawXmlHash,input.existingRawXmlHash].some(h=>h!==null&&!/^[a-f0-9]{64}$/.test(h)) ||
      (input.parserVersion!==null&&!/^[A-Za-z0-9._-]+$/.test(input.parserVersion))) throw new Error('Invalid audit observation');
    // Explicit field selection: unknown request/config properties never enter audit.
    return {accessionNumber:input.accessionNumber,attemptedAt:input.attemptedAt,operation:input.operation,
      outcome:input.outcome,persistenceOutcome:input.persistenceOutcome,
      failure:input.failure?{category:input.failure.category,code:input.failure.code,retryable:input.failure.retryable}:null,
      retryable:input.retryable,parserStatus:input.parserStatus,rawXmlHash:input.rawXmlHash,
      existingRawXmlHash:input.existingRawXmlHash,parserVersion:input.parserVersion,metadata,warnings:[...input.warnings]};
}
/** Local/test audit only. No process persistence, raw XML, request config or logs. */
export class InMemorySecIngestionAudit implements SecIngestionAudit {
  private readonly attempts: SecIngestionAttempt[] = [];
  async recordAttempt(input: SecIngestionAttempt): Promise<void> {
    this.attempts.push(safeSecIngestionAttempt(input));
  }
  async getAttempts(accessionNumber: string): Promise<SecIngestionAttempt[]> {
    return structuredClone(this.attempts.filter(a=>a.accessionNumber===accessionNumber));
  }
}
