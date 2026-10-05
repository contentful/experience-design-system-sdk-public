import type { DatabaseSync } from 'node:sqlite';
import type { TokenToolCall } from '@contentful/experience-design-system-generation';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import { upsertRawToken, upsertRawTokenGroup } from '../../repositories/tokens/write.js';
import { withTransaction } from '../../repositories/shared/with-transaction.js';

export interface ApplyTokenToolCallsResult {
  tokens: number;
  groups: number;
  warnings: string[];
}

export function applyTokenToolCalls(
  db: DatabaseSync,
  sessionId: string,
  calls: TokenToolCall[],
  incomingWarnings: string[],
): ApplyTokenToolCallsResult {
  const now = new Date().toISOString();
  const warnings = [...incomingWarnings];
  let tokens = 0;
  let groups = 0;

  withTransaction(db, () => {
    for (const call of calls) {
      if (call.tool === 'set_token') {
        upsertRawToken(db, sessionId, call);
        tokens++;
      } else if (call.tool === 'set_group') {
        upsertRawTokenGroup(db, sessionId, call);
        groups++;
      }
    }
    updateSessionTimestamp(db, sessionId, now);
  });

  return { tokens, groups, warnings };
}
