import {
  openPipelineDb,
  storeCDFComponents,
  loadCDFComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

export function persistReviewEntry(
  sessionId: string,
  component: { key: string; componentId?: string },
  entry: CDFComponentEntry,
): { ok: true; warnings: string[]; entry?: CDFComponentEntry } | { ok: false; error: string } {
  let db: ReturnType<typeof openPipelineDb> | undefined;
  let committed = false;
  let failure = '';
  let canonicalEntry: CDFComponentEntry | undefined;
  const warnings: string[] = [];
  try {
    db = openPipelineDb();
    storeCDFComponents(db, sessionId, [{ ...component, entry }]);
    committed = true;
    canonicalEntry = loadCDFComponents(db, sessionId).find((row) =>
      component.componentId ? row.componentId === component.componentId : row.key === component.key,
    )?.entry;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Persistence failed';
    if (committed) warnings.push('Saved canonical readback unavailable: ' + message);
    else failure = message;
  } finally {
    try {
      db?.close();
    } catch (error) {
      if (committed) warnings.push(error instanceof Error ? error.message : 'Database cleanup failed');
      else if (!failure) failure = 'Database cleanup failed';
    }
  }
  return committed ? { ok: true, warnings, entry: canonicalEntry } : { ok: false, error: failure };
}
