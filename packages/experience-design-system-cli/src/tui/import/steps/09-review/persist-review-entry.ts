import { openPipelineDb, storeCDFComponents } from '@contentful/experience-design-system-backend-pipeline';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

export function persistReviewEntry(
  sessionId: string,
  component: { key: string; componentId?: string },
  entry: CDFComponentEntry,
): { ok: true; warnings: string[] } | { ok: false; error: string } {
  let db: ReturnType<typeof openPipelineDb> | undefined;
  let committed = false;
  let failure = '';
  const warnings: string[] = [];
  try {
    db = openPipelineDb();
    storeCDFComponents(db, sessionId, [{ ...component, entry }]);
    committed = true;
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Persistence failed';
  } finally {
    try {
      db?.close();
    } catch (error) {
      if (committed) warnings.push(error instanceof Error ? error.message : 'Database cleanup failed');
      else if (!failure) failure = 'Database cleanup failed';
    }
  }
  return committed ? { ok: true, warnings } : { ok: false, error: failure };
}
