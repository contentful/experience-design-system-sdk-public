/** A token default extracted from a design-category token property. */
export interface RawDesignTokenDefault {
  /** The source default, retained verbatim for persistence and review. */
  rawDefault: string;
  /** The property's expected DTCG token type. */
  tokenKind: string | null;
}

/** The path and type of one DTCG token leaf. Values are intentionally absent. */
export interface DTCGTokenLeaf {
  path: string;
  type: string;
}

export type UnresolvedTokenDefaultReason = 'no_match' | 'ambiguous' | 'type_mismatch';

export interface UnresolvedTokenDefault {
  rawDefault: string;
  tokenKind: string | null;
  reason: UnresolvedTokenDefaultReason;
  candidatePaths: string[];
  message: string;
}

export interface ResolveTokenDefaultsResult {
  /** Exact source defaults mapped to their one compatible DTCG path. */
  mappings: Record<string, string>;
  diagnostics: UnresolvedTokenDefault[];
}

function normalizeTokenKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[ _]+/g, '-')
    .toLowerCase();
}

function terminalMember(reference: string): string | undefined {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(reference)) return undefined;
  return reference.slice(reference.lastIndexOf('.') + 1);
}

function describeType(tokenKind: string | null): string {
  return tokenKind === null ? 'the property type' : `a ${tokenKind} token`;
}

/**
 * Resolves extracted source defaults without inspecting token values or changing
 * the source defaults. A normalised leaf-key match is accepted only when it
 * identifies exactly one leaf compatible with the property's token kind.
 */
export function resolveTokenDefaults(
  defaults: readonly RawDesignTokenDefault[],
  leaves: readonly DTCGTokenLeaf[],
): ResolveTokenDefaultsResult {
  const leavesByPath = new Map(leaves.map((leaf) => [leaf.path, leaf]));
  const leavesByNormalizedKey = new Map<string, DTCGTokenLeaf[]>();
  for (const leaf of leaves) {
    const key = leaf.path.slice(leaf.path.lastIndexOf('.') + 1);
    const normalizedKey = normalizeTokenKey(key);
    const matches = leavesByNormalizedKey.get(normalizedKey) ?? [];
    matches.push(leaf);
    leavesByNormalizedKey.set(normalizedKey, matches);
  }

  const outcomesByRawDefault = new Map<
    string,
    { resolvedPaths: string[]; diagnostics: UnresolvedTokenDefault[] }
  >();
  const diagnostics: UnresolvedTokenDefault[] = [];
  const outcomesFor = (rawDefault: string): { resolvedPaths: string[]; diagnostics: UnresolvedTokenDefault[] } => {
    const outcomes = outcomesByRawDefault.get(rawDefault) ?? { resolvedPaths: [], diagnostics: [] };
    outcomesByRawDefault.set(rawDefault, outcomes);
    return outcomes;
  };
  const recordResolvedPath = (rawDefault: string, path: string): void => {
    outcomesFor(rawDefault).resolvedPaths.push(path);
  };
  const recordDiagnostic = (diagnostic: UnresolvedTokenDefault): void => {
    outcomesFor(diagnostic.rawDefault).diagnostics.push(diagnostic);
    diagnostics.push(diagnostic);
  };

  for (const input of defaults) {
    const exactLeaf = leavesByPath.get(input.rawDefault);
    if (exactLeaf !== undefined) {
      if (input.tokenKind === null || exactLeaf.type === input.tokenKind) {
        recordResolvedPath(input.rawDefault, exactLeaf.path);
      } else {
        recordDiagnostic({
          rawDefault: input.rawDefault,
          tokenKind: input.tokenKind,
          reason: 'type_mismatch',
          candidatePaths: [exactLeaf.path],
          message: `Token default '${input.rawDefault}' is a ${exactLeaf.type} token, not ${describeType(input.tokenKind)}.`,
        });
      }
      continue;
    }

    const member = terminalMember(input.rawDefault);
    const candidates = member === undefined ? [] : (leavesByNormalizedKey.get(normalizeTokenKey(member)) ?? []);
    const compatible = input.tokenKind === null ? candidates : candidates.filter((candidate) => candidate.type === input.tokenKind);

    if (compatible.length === 1) {
      recordResolvedPath(input.rawDefault, compatible[0]!.path);
      continue;
    }

    if (compatible.length > 1) {
      recordDiagnostic({
        rawDefault: input.rawDefault,
        tokenKind: input.tokenKind,
        reason: 'ambiguous',
        candidatePaths: compatible.map((candidate) => candidate.path).sort(),
        message: `Token default '${input.rawDefault}' matches multiple compatible DTCG leaves: ${compatible
          .map((candidate) => candidate.path)
          .sort()
          .join(', ')}.`,
      });
      continue;
    }

    if (candidates.length > 0 && input.tokenKind !== null) {
      recordDiagnostic({
        rawDefault: input.rawDefault,
        tokenKind: input.tokenKind,
        reason: 'type_mismatch',
        candidatePaths: candidates.map((candidate) => candidate.path).sort(),
        message: `Token default '${input.rawDefault}' has matching DTCG leaf names, but none is ${describeType(input.tokenKind)}.`,
      });
      continue;
    }

    recordDiagnostic({
      rawDefault: input.rawDefault,
      tokenKind: input.tokenKind,
      reason: 'no_match',
      candidatePaths: [],
      message: `Token default '${input.rawDefault}' does not match a DTCG token leaf.`,
    });
  }

  const mappings: Record<string, string> = {};
  for (const [rawDefault, outcomes] of outcomesByRawDefault) {
    if (outcomes.diagnostics.length > 0) continue;

    const uniquePaths = [...new Set(outcomes.resolvedPaths)];
    if (uniquePaths.length === 1) {
      mappings[rawDefault] = uniquePaths[0]!;
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

  return { mappings, diagnostics };
}
