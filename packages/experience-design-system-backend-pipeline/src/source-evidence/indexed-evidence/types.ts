export type EvidenceValue = null | boolean | number | string | { ref: string };
export type EvidenceRecord =
  | { kind: 'object'; entries: Record<string, EvidenceValue> }
  | { kind: 'array'; entries: EvidenceValue[] }
  | { kind: 'text'; entries: string[] };
export interface EvidenceRecordLocation {
  offset: number;
  bytes: number;
  kind: EvidenceRecord['kind'];
  count: number;
}
export interface EvidenceRecordDescriptor extends EvidenceRecordLocation {
  recordId: string;
}
export interface EvidenceEncodedPage {
  recordId: string;
  kind: EvidenceRecord['kind'];
  total: number;
  offset: number;
  nextOffset: number | null;
  complete: boolean;
  entries: Array<{ key: string; value: EvidenceValue }>;
}
export interface EvidenceCatalogAuthority {
  bytes: number;
  sha256: string;
}
export interface EvidenceCatalogPage {
  operation: 'catalog';
  pointer: string;
  total: number;
  offset: number;
  nextOffset: number | null;
  unread: number;
  complete: boolean;
  entries: Array<Record<string, unknown>>;
}
