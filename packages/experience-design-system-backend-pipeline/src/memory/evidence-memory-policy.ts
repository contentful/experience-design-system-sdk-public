export interface EvidenceMemoryPolicy {
  budgetBytes: number;
  headroomFraction: number;
  reservationBytes: number;
  maxPreparing: number;
  maxQueuedJobs: number;
  maxQueuedBytes?: number;
}

export const DEFAULT_EVIDENCE_MEMORY_POLICY: Readonly<EvidenceMemoryPolicy> = Object.freeze({
  budgetBytes: 4 * 1024 ** 3,
  headroomFraction: 0.25,
  reservationBytes: 1024 ** 3,
  maxPreparing: 1,
  maxQueuedJobs: 64,
  maxQueuedBytes: 512 * 1024 ** 2,
});
