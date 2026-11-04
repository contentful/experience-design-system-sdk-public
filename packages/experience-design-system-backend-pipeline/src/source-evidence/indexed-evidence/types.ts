export type EvidenceValue = null | boolean | number | string | { ref: string };
export type EvidenceRecord =
  | { kind: 'object'; entries: Record<string, EvidenceValue> }
  | { kind: 'array'; entries: EvidenceValue[] }
  | { kind: 'text'; entries: string[] };
export interface EvidenceManifest {
  version: 1;
  root: EvidenceValue;
  records: Record<string, { offset: number; bytes: number; kind: EvidenceRecord['kind']; count: number }>;
}
export interface IndexedEvidenceRequest {
  directory: string;
  input: Record<string, unknown>;
  rawComponentsInline?: string;
  rawComponents?: readonly import('../../steps/extraction/src/types/component.js').RawComponentDefinition[];
  candidateFree?: boolean;
}
export interface IndexedEvidenceResult {
  digest: string;
  recordCount: number;
  bytes: number;
  index: Record<string, unknown>;
}
