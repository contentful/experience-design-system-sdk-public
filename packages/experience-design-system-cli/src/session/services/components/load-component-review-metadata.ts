import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getComponentReviewSource } from '../../repositories/components/raw/read.js';

export interface ComponentReviewMetadata {
  sourcePath: string | null;
  componentSource: string | null;
  props: Record<string, { rationale: string | null; sourceStartLine: number | null; sourceEndLine: number | null }>;
}

export function loadComponentReviewMetadata(
  db: DatabaseSync,
  sessionId: string,
  componentName: string,
): ComponentReviewMetadata | null {
  const row = getComponentReviewSource(db, sessionId, componentName);
  if (!row) return null;

  const props: ComponentReviewMetadata['props'] = {};
  for (const p of row.props) {
    props[p.name] = {
      rationale: p.rationale,
      sourceStartLine: p.sourceStartLine,
      sourceEndLine: p.sourceEndLine,
    };
  }

  // raw_components.source historically stores the file path, not the file
  // text. For the source-view panel to render real lines, prefer reading
  // the file from disk via source_path. Fall back to whatever's in `source`
  // (handles in-memory fixtures and tests).
  let componentSource: string | null = row.source ?? null;
  if (row.sourcePath) {
    try {
      componentSource = readFileSync(row.sourcePath, 'utf8');
    } catch {
      // File no longer exists or unreadable — leave fallback.
    }
  }

  return {
    sourcePath: row.sourcePath,
    componentSource,
    props,
  };
}
