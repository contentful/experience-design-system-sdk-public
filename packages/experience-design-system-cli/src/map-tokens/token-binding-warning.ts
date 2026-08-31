import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildTokenIndex,
  proveTokenBinding,
  type SourceFile,
  type TokenSidecar,
} from '@contentful/experience-design-system-extraction';
import { loadSiblingFiles, loadTokenBindingCandidates } from '../session/db.js';

export interface TokenBindingWarningOptions {
  tokensInline?: string;
  tokenMapInline?: string;
}

export interface TokenBindingWarningResult {
  warnings: string[];
}

function parseJson(input: string | undefined, label: string, warnings: string[]): unknown {
  if (input === undefined) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    warnings.push(`token binding: could not parse ${label} as JSON — skipping token-binding check`);
    return undefined;
  }
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
  return [
    { path: sourcePath, text: ownText },
    ...siblings.map((s) => ({ path: s.path, text: s.content })),
  ];
}

/**
 * Checks every design prop the classifier already marked `token` against the
 * DTCG tree, and warns when a prop's values resolve only partially or not at
 * all. This is advisory only — it never mutates classification. The model's
 * classification is authoritative; this scan exists to surface cases where a
 * token classification isn't actually backed by a resolvable token, so an
 * operator can investigate.
 *
 * A prop with no values to resolve is the normal genuine-token case and never
 * warns. A prop the classifier left as `enum` is out of scope here — all of
 * its values resolving to tokens is now the expected, correct outcome.
 */
export async function warnUnresolvedTokenBindings(
  db: DatabaseSync,
  sessionId: string,
  opts: TokenBindingWarningOptions,
): Promise<TokenBindingWarningResult> {
  const warnings: string[] = [];
  const tree = parseJson(opts.tokensInline, 'token document', warnings);
  const sidecar = (parseJson(opts.tokenMapInline, 'token-name sidecar', warnings) ?? {}) as TokenSidecar;

  const index = buildTokenIndex(tree);
  const candidates = loadTokenBindingCandidates(db, sessionId).filter(
    (c) => c.cdfType === 'token' && c.values.length > 0,
  );

  if (candidates.length === 0) return { warnings };

  if (index.size === 0) {
    warnings.push(
      `token binding: no token document supplied — ${candidates.length} token-classified design ${
        candidates.length === 1 ? 'property' : 'properties'
      } could not be checked against it. Run 'generate tokens' first, and pass --token-map when the design system references tokens through a flat JS accessor.`,
    );
    return { warnings };
  }

  const sourceCache = new Map<string, SourceFile[]>();

  for (const candidate of candidates) {
    const cacheKey = candidate.sourcePath ?? '';
    if (!sourceCache.has(cacheKey)) {
      sourceCache.set(cacheKey, await readSources(candidate.sourcePath));
    }
    const sources = sourceCache.get(cacheKey) ?? [];
    if (sources.length === 0) continue;

    const result = proveTokenBinding({ values: candidate.values, sources, sidecar, index });
    const label = `${candidate.componentName}.${candidate.propName}`;

    if (result.status === 'proven') continue;

    if (result.status === 'partial') {
      if (result.unresolved.length > 0) {
        warnings.push(
          `token binding '${label}': classified as token, but only ${result.resolved.length} of ${candidate.values.length} values resolve to design tokens (unresolved: ${result.unresolved.join(', ')}) — verify this prop's token backing.`,
        );
      } else {
        // All values resolved, but not to a single consistent token $type —
        // a different problem than an unresolved value, and worth calling
        // out distinctly so an operator knows which one they're looking at.
        warnings.push(
          `token binding '${label}': classified as token, and all ${candidate.values.length} values resolve to design tokens, but not to a single consistent token type — verify this prop's token backing.`,
        );
      }
      continue;
    }

    warnings.push(
      `token binding '${label}': classified as token, but none of its ${candidate.values.length} values resolve to a design token — verify this prop's token backing.`,
    );
  }

  return { warnings };
}
