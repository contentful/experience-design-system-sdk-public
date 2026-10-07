export type EdgeProvenance = 'typed-slot' | 'structural' | 'manifest' | 'doc' | `adapter:${string}` | 'agent';

export type CompositionEdge = {
  parent: string;
  child: string;
  slot?: string;
  confidence?: number;
  provenance: EdgeProvenance;
};
