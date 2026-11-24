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
