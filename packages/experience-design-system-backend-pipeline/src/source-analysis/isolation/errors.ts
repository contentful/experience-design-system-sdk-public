export type IsolationFailureReason =
  | 'request-too-large'
  | 'result-too-large'
  | 'unsupported-value'
  | 'invalid-handle'
  | 'parent-pressure'
  | 'child-pressure'
  | 'child-start'
  | 'child-exit'
  | 'child-memory'
  | 'task-failed';

export interface IsolationFailure {
  reason: IsolationFailureReason;
  operation: string;
  scope: 'request' | 'result' | 'process';
  signal?: NodeJS.Signals | null;
  exitCode?: number | null;
  observedRssBytes?: number;
  observedHeapBytes?: number;
  heapLimitBytes?: number;
  limitBytes?: number;
}

export class SourceIsolationError extends Error {
  readonly code = 'SOURCE_ISOLATION_FAILURE';
  readonly retryable = false;
  readonly nextAction = 'Use bounded evidence handles or reduce the assigned work before trying again.';
  constructor(readonly failure: IsolationFailure) {
    super(
      `Source analysis could not complete within its isolated resource boundary. ${failure.operation}: ${failure.reason} at ${failure.scope}.`,
    );
    this.name = 'SourceIsolationError';
  }
}
