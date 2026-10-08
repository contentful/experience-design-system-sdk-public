import {
  findLatestSessionForCommand,
  loadDTCGTokens,
  openPipelineDb,
} from '../../../../../persistence/src/session/repositories/db.js';
import { rebuildDTCGTree } from '../../../../shared/dtcg/helpers/rebuild-dtcg-tree.js';
import type { ExportDtcgTreeError, ExportDtcgTreeRequest, ExportDtcgTreeResult } from './types-export.js';

export class ExportDtcgTreeFailure extends Error {
  constructor(public readonly reason: ExportDtcgTreeError) {
    super(ExportDtcgTreeFailure.format(reason));
  }
  static format(r: ExportDtcgTreeError): string {
    switch (r.type) {
      case 'no-session':
        return `no completed ${r.command} session found. Run ${r.command} first, or pass sessionId.`;
      case 'empty':
        return `no generated tokens in session '${r.sessionId}'. Run generate tokens first.`;
    }
  }
}

export async function exportDtcgTree(request: ExportDtcgTreeRequest): Promise<ExportDtcgTreeResult> {
  const db = openPipelineDb();
  try {
    const sessionId = request.sessionId ?? findLatestSessionForCommand(db, 'generate tokens');
    if (!sessionId) {
      throw new ExportDtcgTreeFailure({ type: 'no-session', command: 'generate tokens' });
    }
    const result = loadDTCGTokens(db, sessionId);
    if (result.tokens.length === 0) {
      throw new ExportDtcgTreeFailure({ type: 'empty', sessionId });
    }
    const tree = rebuildDTCGTree(result.groups, result.tokens);
    return { tree, tokenCount: result.tokens.length, sessionId };
  } finally {
    db.close();
  }
}

// Legacy-name aliases.
export { exportDtcgTree as printTokens };
export { ExportDtcgTreeFailure as PrintTokensFailure };
