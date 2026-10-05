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

export function formatDiagnostics(result: ValidationResult): string {
  if (result.valid) {
    return `✓ ${result.summary}`;
  }

  const count = result.diagnostics.length;
  const header = `✗ ${count} error${count === 1 ? '' : 's'} found`;

  const entries = result.diagnostics.map((d, i) => {
    const lines = [`  ${i + 1}. ${d.path}`, `     ${d.message}`];
    if (d.expected !== undefined) {
      lines.push(`     expected: ${d.expected}`);
    }
    if (d.actual !== undefined) {
      lines.push(`     actual:   ${d.actual}`);
    }
    return lines.join('\n');
  });

  return `${header}\n\n${entries.join('\n\n')}`;
}
