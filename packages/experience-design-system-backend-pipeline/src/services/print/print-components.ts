import { findLatestSessionForCommand, loadCDFComponents, openPipelineDb } from '../../persistence/session/db.js';
import { CDF_SCHEMA_URL } from '../../steps/shared/cdf/constants/schema.js';
import type { PrintComponentsError, PrintComponentsRequest, PrintComponentsResult } from './types/print.js';

export class PrintComponentsFailure extends Error {
  constructor(public readonly reason: PrintComponentsError) {
    super(PrintComponentsFailure.format(reason));
  }
  static format(r: PrintComponentsError): string {
    switch (r.type) {
      case 'no-session':
        return `no completed ${r.command} session found. Run ${r.command} first, or pass sessionId.`;
      case 'empty-rejected-no-allow':
        return `all ${r.rejectedCount} generated component${r.rejectedCount === 1 ? ' was' : 's were'} rejected or left unresolved at final review in session '${r.sessionId}'. Accept at least one component, or set allowEmpty to write an empty CDF file.`;
      case 'empty':
        return `no generated components in session '${r.sessionId}'. Run generate components first.`;
    }
  }
}

/**
 * Resolve a session, load its CDF components, and build the output document.
 * Pure: never writes to disk or stdout — the caller does that.
 */
export async function printComponents(request: PrintComponentsRequest): Promise<PrintComponentsResult> {
  const db = openPipelineDb();
  try {
    const sessionId = request.sessionId ?? findLatestSessionForCommand(db, 'generate components');
    if (!sessionId) {
      throw new PrintComponentsFailure({ type: 'no-session', command: 'generate components' });
    }

    const components = loadCDFComponents(db, sessionId);
    const stepRow = db
      .prepare(
        `SELECT status FROM steps WHERE session_id = ? AND command = 'generate components' ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId) as { status: string } | undefined;
    const generateStepFailed = stepRow?.status === 'failed';
    const rejectedRow = db
      .prepare(`SELECT COUNT(*) AS n FROM raw_components WHERE session_id = ? AND status = 'generate-rejected'`)
      .get(sessionId) as { n: number } | undefined;
    const rejectedCount = rejectedRow?.n ?? 0;

    if (components.length === 0) {
      if (rejectedCount > 0 && !request.allowEmpty) {
        throw new PrintComponentsFailure({ type: 'empty-rejected-no-allow', rejectedCount, sessionId });
      }
      if (rejectedCount === 0) {
        throw new PrintComponentsFailure({ type: 'empty', sessionId });
      }
    }

    const cdf: Record<string, unknown> = { $schema: CDF_SCHEMA_URL };
    const missingDescription: string[] = [];
    for (const { key, entry } of components) {
      cdf[key] = entry;
      if (!entry.$description) missingDescription.push(key);
    }

    return {
      cdf,
      componentCount: components.length,
      missingDescription,
      generateStepFailed,
      sessionId,
    };
  } finally {
    db.close();
  }
}
