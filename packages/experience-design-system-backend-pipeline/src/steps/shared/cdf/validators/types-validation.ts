export interface ValidationDiagnostic {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationResult {
  valid: boolean;
  summary: string;
  diagnostics: ValidationDiagnostic[];
}
