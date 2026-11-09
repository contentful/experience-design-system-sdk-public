export type PushProgress =
  | { kind: 'queued'; operationId: string }
  // `failed` counts the entities that have been rejected so far: the push carries on with the rest, so they are shown as
  // they happen and not only when it ends.
  | { kind: 'progress'; processed: number; total: number; failed: number; current: string | null }
  | null;
