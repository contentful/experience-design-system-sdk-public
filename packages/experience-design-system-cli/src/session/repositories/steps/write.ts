import type { DatabaseSync } from 'node:sqlite';
import type { CommandName } from '../../db.js';

/**
 * Flip every step for this session+command that is still in the 'pending'
 * status to 'interrupted'. Called right before creating a fresh pending step
 * for the same command so we never leave zombie 'pending' rows behind.
 */
export function updatePendingStepsToInterrupted(
  db: DatabaseSync,
  sessionId: string,
  command: CommandName,
  timestamp: string,
): void {
  db.prepare(
    `UPDATE steps SET status = 'interrupted', completed_at = ?, updated_at = ?
     WHERE session_id = ? AND command = ? AND status = 'pending'`,
  ).run(timestamp, timestamp, sessionId, command);
}

export function createPendingStep(
  db: DatabaseSync,
  sessionId: string,
  command: CommandName,
  inputs: Record<string, string>,
  timestamp: string,
): number {
  const result = db
    .prepare(
      `INSERT INTO steps (session_id, command, status, started_at, inputs, outputs, updated_at)
       VALUES (?, ?, 'pending', ?, ?, '{}', ?)`,
    )
    .run(sessionId, command, timestamp, JSON.stringify(inputs), timestamp) as {
    lastInsertRowid: number | bigint;
  };
  return Number(result.lastInsertRowid);
}

/**
 * Set a step's terminal state (status = 'complete' | 'failed'), its outputs,
 * its error (if any), and `completed_at`. Called once when the step's work
 * has finished, successfully or not.
 */
export function updateStepStatus(
  db: DatabaseSync,
  stepId: number,
  status: 'complete' | 'failed',
  outputs: Record<string, string>,
  error: string | null,
  timestamp: string,
): void {
  db.prepare(`UPDATE steps SET status = ?, completed_at = ?, outputs = ?, error = ?, updated_at = ? WHERE id = ?`).run(
    status,
    timestamp,
    JSON.stringify(outputs),
    error,
    timestamp,
    stepId,
  );
}
