export type ClosureProofStrength = 'exact' | 'inferred' | 'unknown';
export interface ClosureFact<Value = unknown> {
  readonly value: Value;
  readonly strength: ClosureProofStrength;
  readonly dependsOnOpenEnd: boolean;
  readonly provenance: readonly string[];
}
export type ClosureSummary = Readonly<Record<string, ClosureFact>>;
export interface ClosureEnd {
  kind: 'open' | 'dead';
  reason: string;
  target?: string;
}
export interface ClosureEdge {
  target: string;
  kind: string;
}
export interface ClosureNode<Local> {
  id: string;
  data: Local;
  edges: readonly ClosureEdge[];
  ends: readonly ClosureEnd[];
}
export interface ClosureGraph<Local> {
  roots: readonly string[];
  missingRoots: readonly string[];
  nodes: ReadonlyMap<string, ClosureNode<Local>>;
}
export interface ClosureScc {
  members: string[];
  cyclic: boolean;
}
export interface ClosureAdapter<Local> {
  bottom(node: ClosureNode<Local>): ClosureSummary;
  transfer(node: ClosureNode<Local>, getSummary: (id: string) => ClosureSummary | undefined): ClosureSummary;
}
