import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildTokenIndex,
  proveTokenBinding,
  type SourceFile,
  type TokenSidecar,
} from '@contentful/experience-design-system-extraction';
import { loadSiblingFiles, loadTokenBindingCandidates } from '../session/db.js';

export interface TokenBackedEnumAnnotation {
  component: string;
  prop: string;
  resolved: number;
  total: number;
}

async function readSources(sourcePath: string | null): Promise<SourceFile[]> {
  if (!sourcePath) return [];
  let ownText: string;
  try {
    ownText = await readFile(sourcePath, 'utf8');
  } catch {
    return [];
  }
  const { siblings } = await loadSiblingFiles(ownText, sourcePath);
  return [{ path: sourcePath, text: ownText }, ...siblings.map((s) => ({ path: s.path, text: s.content }))];
}

/**
 * Finds enum props whose every value resolves to a design token, purely as an
 * informational annotation for the developer reviewing an import — never a
 * suggestion to reclassify. The prop stays enum; nothing here mutates it.
 */
export async function computeTokenBackedEnumAnnotations(
  db: DatabaseSync,
  sessionId: string,
  tree: unknown,
  sidecar: TokenSidecar = {},
): Promise<TokenBackedEnumAnnotation[]> {
  const index = buildTokenIndex(tree);
  if (index.size === 0) return [];

  const candidates = loadTokenBindingCandidates(db, sessionId).filter(
    (c) => c.cdfType === 'enum' && c.values.length > 0,
  );

  const annotations: TokenBackedEnumAnnotation[] = [];
  const sourceCache = new Map<string, SourceFile[]>();

  for (const candidate of candidates) {
    const cacheKey = candidate.sourcePath ?? '';
    if (!sourceCache.has(cacheKey)) {
      sourceCache.set(cacheKey, await readSources(candidate.sourcePath));
    }
    const sources = sourceCache.get(cacheKey) ?? [];
    if (sources.length === 0) continue;

    const result = proveTokenBinding({ values: candidate.values, sources, sidecar, index });
    if (result.status === 'proven') {
      annotations.push({
        component: candidate.componentName,
        prop: candidate.propName,
        resolved: candidate.values.length,
        total: candidate.values.length,
      });
    }
  }

  return annotations;
}
