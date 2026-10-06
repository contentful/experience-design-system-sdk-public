/**
 * The CLI-owned composition interchange format (spec T1).
 *
 * `CompositionEdge[]` is the flat internal runtime view, one edge per
 * parent→child relationship, carrying optional `slot` (T7), `confidence`,
 * and `provenance`. It is easier to merge and dedupe across sources (T2).
 */

export type EdgeProvenance = 'typed-slot' | 'structural' | 'call-site' | 'manifest' | 'doc' | `adapter:${string}`;

export type CompositionEdge = {
  parent: string;
  child: string;
  /** Optional named slot (T7). Default slot when omitted. */
  slot?: string;
  /** 1–5 scale, same as select/reject agent tools. */
  confidence?: number;
  citation?: CompositionCitation;
  provenance: EdgeProvenance;
};

export type CompositionCitation = {
  sourcePath: string;
  startLine: number;
  endLine: number;
};
