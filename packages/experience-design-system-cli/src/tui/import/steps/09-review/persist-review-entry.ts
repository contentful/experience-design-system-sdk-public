import {
  openPipelineDb,
  storeReviewCDFComponent,
  loadReviewCDFComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

export function persistReviewEntry(
  sessionId: string,
  component: { key: string; componentId?: string },
  entry: CDFComponentEntry,
):
  | { ok: true; warnings: string[]; entry?: CDFComponentEntry; components?: ReturnType<typeof loadReviewCDFComponents> }
  | { ok: false; error: string } {
  let db: ReturnType<typeof openPipelineDb> | undefined;
  let committed = false;
  let failure = '';
  let canonicalEntry: CDFComponentEntry | undefined;
  let canonicalComponents: ReturnType<typeof loadReviewCDFComponents> | undefined;
  const warnings: string[] = [];
  try {
    db = openPipelineDb();
    storeReviewCDFComponent(db, sessionId, component, entry);
    committed = true;
    canonicalComponents = loadReviewCDFComponents(db, sessionId);
    canonicalEntry = canonicalComponents.find((row) =>
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
  return committed
    ? { ok: true, warnings, entry: canonicalEntry, components: canonicalComponents }
    : { ok: false, error: failure };
}
