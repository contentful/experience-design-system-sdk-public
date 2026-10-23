export type PushProgress =
  | { kind: 'queued'; operationId: string }
  | { kind: 'progress'; processed: number; total: number; current: string | null }
  | null;
