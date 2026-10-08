export type ReportLine =
  | { kind: 'section'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'fail'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'info'; text: string };

export interface CheckOutcome {
  name: string;
  ok: boolean;
  required: boolean;
  lines: ReportLine[];
}
