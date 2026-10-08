import { appendFile } from 'node:fs/promises';
import type { ReviewEvent } from '../types/review-session.js';

export async function appendReviewEvent(
  eventsPath: string,
  event: { type: string; payload: Record<string, unknown> },
): Promise<void> {
  const record: ReviewEvent = {
    type: event.type,
    timestamp: new Date().toISOString(),
    payload: event.payload,
  };
  await appendFile(eventsPath, JSON.stringify(record) + '\n', 'utf8');
}
