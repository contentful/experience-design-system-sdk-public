import type {
  DTCGTokenLeaf,
  RawDesignTokenDefault,
  ResolveTokenDefaultsResult,
  UnresolvedTokenDefault,
} from '../../types/token-defaults.js';
import { normalizeTokenKey } from './normalize-token-key.js';
import { terminalMember } from './terminal-member.js';

function describeType(tokenKind: string | null): string {
  return tokenKind === null ? 'the property type' : `a ${tokenKind} token`;
}

/**
 * Resolve extracted source defaults to their DTCG leaf paths. A normalised
 * leaf-key match is accepted only when it uniquely identifies one leaf
 * compatible with the property's token kind.
 */
export function resolveTokenDefaults(
  defaults: readonly RawDesignTokenDefault[],
  leaves: readonly DTCGTokenLeaf[],
): ResolveTokenDefaultsResult {
  const leavesByPath = new Map(leaves.map((leaf) => [leaf.path, leaf]));
  const leavesByNormalizedKey = buildNormalizedIndex(leaves);
  const outcomesByRawDefault = new Map<string, { resolvedPaths: string[]; diagnostics: UnresolvedTokenDefault[] }>();
  const diagnostics: UnresolvedTokenDefault[] = [];

  const outcomesFor = (rawDefault: string) => {
    const outcomes = outcomesByRawDefault.get(rawDefault) ?? { resolvedPaths: [], diagnostics: [] };
    outcomesByRawDefault.set(rawDefault, outcomes);
    return outcomes;
  };
  const recordResolvedPath = (rawDefault: string, path: string): void => {
    outcomesFor(rawDefault).resolvedPaths.push(path);
  };
  const recordDiagnostic = (d: UnresolvedTokenDefault): void => {
    outcomesFor(d.rawDefault).diagnostics.push(d);
    diagnostics.push(d);
  };

  for (const input of defaults) {
    classifyOneDefault(input, leavesByPath, leavesByNormalizedKey, recordResolvedPath, recordDiagnostic, describeType);
  }

  const mappings = finalizeMappings(outcomesByRawDefault, recordDiagnostic);
  return { mappings, diagnostics };
}

function buildNormalizedIndex(leaves: readonly DTCGTokenLeaf[]): Map<string, DTCGTokenLeaf[]> {
  const out = new Map<string, DTCGTokenLeaf[]>();
  for (const leaf of leaves) {
    const key = leaf.path.slice(leaf.path.lastIndexOf('.') + 1);
    const normalizedKey = normalizeTokenKey(key);
    const matches = out.get(normalizedKey) ?? [];
    matches.push(leaf);
    out.set(normalizedKey, matches);
  }
  return out;
}

function classifyOneDefault(
  input: RawDesignTokenDefault,
  leavesByPath: Map<string, DTCGTokenLeaf>,
  leavesByNormalizedKey: Map<string, DTCGTokenLeaf[]>,
  recordResolvedPath: (rawDefault: string, path: string) => void,
  recordDiagnostic: (d: UnresolvedTokenDefault) => void,
  describeType: (k: string | null) => string,
): void {
  const exact = leavesByPath.get(input.rawDefault);
  if (exact !== undefined) {
    if (input.tokenKind === null || exact.type === input.tokenKind) {
      recordResolvedPath(input.rawDefault, exact.path);
    } else {
      recordDiagnostic({
        rawDefault: input.rawDefault,
        tokenKind: input.tokenKind,
        reason: 'type_mismatch',
        candidatePaths: [exact.path],
        message: `Token default '${input.rawDefault}' is a ${exact.type} token, not ${describeType(input.tokenKind)}.`,
      });
    }
    return;
  }

  const member = terminalMember(input.rawDefault);
  const candidates = member === undefined ? [] : (leavesByNormalizedKey.get(normalizeTokenKey(member)) ?? []);
  const compatible = input.tokenKind === null ? candidates : candidates.filter((c) => c.type === input.tokenKind);

  if (compatible.length === 1) {
    recordResolvedPath(input.rawDefault, (compatible[0] as DTCGTokenLeaf).path);
    return;
  }
  if (compatible.length > 1) {
    recordDiagnostic({
      rawDefault: input.rawDefault,
      tokenKind: input.tokenKind,
      reason: 'ambiguous',
      candidatePaths: compatible.map((c) => c.path).sort(),
      message: `Token default '${input.rawDefault}' matches multiple compatible DTCG leaves: ${compatible
        .map((c) => c.path)
        .sort()
        .join(', ')}.`,
    });
    return;
  }
  if (candidates.length > 0 && input.tokenKind !== null) {
    recordDiagnostic({
      rawDefault: input.rawDefault,
      tokenKind: input.tokenKind,
      reason: 'type_mismatch',
      candidatePaths: candidates.map((c) => c.path).sort(),
      message: `Token default '${input.rawDefault}' has matching DTCG leaf names, but none is ${describeType(input.tokenKind)}.`,
    });
    return;
  }
  recordDiagnostic({
    rawDefault: input.rawDefault,
    tokenKind: input.tokenKind,
    reason: 'no_match',
    candidatePaths: [],
    message: `Token default '${input.rawDefault}' does not match a DTCG token leaf.`,
  });
}

function finalizeMappings(
  outcomesByRawDefault: Map<string, { resolvedPaths: string[]; diagnostics: UnresolvedTokenDefault[] }>,
  recordDiagnostic: (d: UnresolvedTokenDefault) => void,
): Record<string, string> {
  const mappings: Record<string, string> = {};
  for (const [rawDefault, outcomes] of outcomesByRawDefault) {
    if (outcomes.diagnostics.length > 0) continue;
    const uniquePaths = [...new Set(outcomes.resolvedPaths)];
    if (uniquePaths.length === 1) {
      mappings[rawDefault] = uniquePaths[0] as string;
      continue;
    }
    recordDiagnostic({
      rawDefault,
      tokenKind: null,
      reason: 'ambiguous',
      candidatePaths: uniquePaths.sort(),
      message: `Token default '${rawDefault}' resolves to different compatible DTCG leaves across properties: ${uniquePaths
        .sort()
        .join(', ')}.`,
    });
  }
  return mappings;
}
