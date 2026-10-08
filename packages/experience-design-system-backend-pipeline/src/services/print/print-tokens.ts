import { findLatestSessionForCommand, loadDTCGTokens, openPipelineDb } from '../../persistence/session/db.js';
import { rebuildDTCGTree } from './helpers/rebuild-dtcg-tree.js';
import type { PrintTokensError, PrintTokensRequest, PrintTokensResult } from './types/print.js';

export class PrintTokensFailure extends Error {
  constructor(public readonly reason: PrintTokensError) {
    super(PrintTokensFailure.format(reason));
  }
  static format(r: PrintTokensError): string {
    switch (r.type) {
      case 'no-session':
        return `no completed ${r.command} session found. Run ${r.command} first, or pass sessionId.`;
      case 'empty':
        return `no generated tokens in session '${r.sessionId}'. Run generate tokens first.`;
    }
  }
}

export async function printTokens(request: PrintTokensRequest): Promise<PrintTokensResult> {
  const db = openPipelineDb();
  try {
    const sessionId = request.sessionId ?? findLatestSessionForCommand(db, 'generate tokens');
    if (!sessionId) {
      throw new PrintTokensFailure({ type: 'no-session', command: 'generate tokens' });
    }
    const result = loadDTCGTokens(db, sessionId);
    if (result.tokens.length === 0) {
      throw new PrintTokensFailure({ type: 'empty', sessionId });
    }
    const tree = rebuildDTCGTree(result.groups, result.tokens);
    return { tree, tokenCount: result.tokens.length, sessionId };
  } finally {
    db.close();
  }
}
