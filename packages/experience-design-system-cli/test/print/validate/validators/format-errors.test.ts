import { describe, it, expect } from 'vitest';
import { formatDiagnostics, type ValidationResult } from '../../../../src/print/validate/validators/format-errors.js';

describe('formatDiagnostics', () => {
  it('formats success output with checkmark', () => {
    const result: ValidationResult = {
      valid: true,
      summary: 'Valid CDF v1 — 2 components found',
      diagnostics: [],
    };
    const output = formatDiagnostics(result);
    expect(output).toBe('✓ Valid CDF v1 — 2 components found');
  });

  it('formats error output with numbered diagnostics', () => {
    const result: ValidationResult = {
      valid: false,
      summary: '',
      diagnostics: [
        { path: '/Button/$properties/label/$type', message: 'Invalid type' },
        { path: '/Card/$properties/title', message: 'Missing property' },
      ],
    };
    const output = formatDiagnostics(result);
    expect(output).toContain('✗ 2 errors found');
    expect(output).toContain('1. /Button/$properties/label/$type');
    expect(output).toContain('   Invalid type');
    expect(output).toContain('2. /Card/$properties/title');
    expect(output).toContain('   Missing property');
  });

  it('includes expected/actual when present', () => {
    const result: ValidationResult = {
      valid: false,
      summary: '',
      diagnostics: [
        {
          path: '/Button/$properties/label/$type',
          message: 'Invalid type',
          expected: 'string, number, boolean',
          actual: 'select',
        },
      ],
    };
    const output = formatDiagnostics(result);
    expect(output).toContain('expected: string, number, boolean');
    expect(output).toContain('actual:   select');
  });

  it('omits expected/actual when absent', () => {
    const result: ValidationResult = {
      valid: false,
      summary: '',
      diagnostics: [{ path: '/root', message: 'Something wrong' }],
    };
    const output = formatDiagnostics(result);
    expect(output).not.toContain('expected:');
    expect(output).not.toContain('actual:');
  });

  it('uses singular "error" for single diagnostic', () => {
    const result: ValidationResult = {
      valid: false,
      summary: '',
      diagnostics: [{ path: '/only', message: 'One problem' }],
    };
    const output = formatDiagnostics(result);
    expect(output).toContain('✗ 1 error found');
    expect(output).not.toContain('errors');
  });
});
