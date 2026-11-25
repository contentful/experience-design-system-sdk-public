export type MemoryCapacityReason =
  | 'queue-full'
  | 'queue-bytes-full'
  | 'idle-pressure'
  | 'reservation-too-large'
  | 'dependency-wait'
  | 'measurement-limit';

export class ImportMemoryCapacityError extends Error {
  readonly code = 'IMPORT_MEMORY_CAPACITY';
  constructor(
    readonly reason: MemoryCapacityReason,
    readonly budgetBytes: number,
    readonly observedRssBytes: number,
    message = 'Evidence preparation cannot fit the current memory budget; release retained evidence or use smaller work assignments.',
  ) {
    super(message);
    this.name = 'ImportMemoryCapacityError';
  }
}
