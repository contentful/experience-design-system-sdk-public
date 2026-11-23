import { AsyncLocalStorage } from 'node:async_hooks';

export interface EvidenceMemoryWait {
  state: 'waiting' | 'admitted' | 'cancelled' | 'rejected';
  waitMs: number;
  estimatedPeakBytes: number;
  queuedBytes: number;
  reservedBytes: number;
  retainedBytes: number;
  budgetBytes: number;
}
export interface EvidenceMemoryScope {
  owner: symbol;
  onWait?: (event: EvidenceMemoryWait) => void;
}
const scopes = new AsyncLocalStorage<EvidenceMemoryScope>();
export const currentEvidenceMemoryScope = (): EvidenceMemoryScope | undefined => scopes.getStore();

export function withEvidenceMemoryScope<T>(scope: EvidenceMemoryScope, work: () => T): T {
  return scopes.run(scope, work);
}
