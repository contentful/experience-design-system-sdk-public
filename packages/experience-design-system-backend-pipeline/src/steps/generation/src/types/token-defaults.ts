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
