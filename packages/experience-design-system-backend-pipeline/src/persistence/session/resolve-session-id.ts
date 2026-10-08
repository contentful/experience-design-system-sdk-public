import { findLatestSessionForCommand, openPipelineDb } from './db.js';

function findLatestExtractSessionId(): string | null {
  const db = openPipelineDb();
  try {
    return findLatestSessionForCommand(db, 'analyze extract');
  } finally {
    db.close();
  }
}

export async function resolveExtractSessionId(
  sessionFlag: string | undefined,
  onMissing: () => Promise<string> | string,
): Promise<string> {
  if (sessionFlag) return sessionFlag;
  const sessionId = findLatestExtractSessionId();
  if (sessionId) return sessionId;
  process.stderr.write(
    'Error: no completed analyze extract session found. Run analyze extract first, or pass --session <id>.\n',
  );
  return await onMissing();
}
