import type { ActivityItem } from '../../../shared/running-step/activity.js';

export type PushProgress =
  | { kind: 'queued'; operationId: string }
  // `failed` counts the entities that have been rejected so far: the push carries on with the rest, so they are shown as
  // they happen and not only when it ends. `items` is each entity that has been processed, for the activity panel.
  | {
      kind: 'progress';
      processed: number;
      total: number;
      failed: number;
      current: string | null;
      items: ActivityItem[];
    }
  | null;

/** What the API reports for one entity in the push. */
interface OperationItem {
  entityType: string;
  action: string;
  id: string;
  status: string;
  /** The API gives the reason as an object with a message, or as plain text. */
  error?: string | { message: string };
}

/**
 * The panel's entries for the entities the push has processed so far. An entity still waiting in the queue is left out,
 * so the panel shows what has happened and not a list of everything that is yet to.
 */
export function activityFromItems(items: readonly OperationItem[]): ActivityItem[] {
  return items
    .filter((item) => item.status !== 'queued')
    .map((item) => ({
      name: item.id,
      state: item.status === 'failed' ? ('failed' as const) : ('done' as const),
      detail: `${item.action} ${item.entityType === 'DesignToken' ? 'token' : 'component'}`,
      ...(item.error ? { error: typeof item.error === 'string' ? item.error : item.error.message } : {}),
    }));
}
