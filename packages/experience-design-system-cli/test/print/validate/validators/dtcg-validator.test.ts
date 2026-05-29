import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { validateDTCGTokenFile } from '../../../../src/print/validate/validators/dtcg-validator.js';

const fixtures = resolve(import.meta.dirname, '../../../fixtures');

describe('validateDTCGTokenFile', () => {
  it('returns valid for a well-formed token file', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'valid-tokens.json'));
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary).toContain('3 tokens');
    expect(result.summary).toContain('2 groups');
  });

  it('returns errors for invalid $type value', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'invalid-tokens.json'));
    expect(result.valid).toBe(false);
    const typeError = result.diagnostics.find((d) => d.path === '/colors/primary/$type');
    expect(typeError).toBeDefined();
    expect(typeError!.message).toContain('Invalid');
    expect(typeError!.expected).toContain('color');
    expect(typeError!.actual).toBe('colour');
  });

  it('returns errors for missing $value on a token with $type', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'invalid-tokens.json'));
    const missingValue = result.diagnostics.find((d) => d.path === '/colors/secondary');
    expect(missingValue).toBeDefined();
    expect(missingValue!.message).toContain('$value');
  });

  it('returns errors for missing $type on a token with $value', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'invalid-tokens.json'));
    const missingType = result.diagnostics.find((d) => d.path === '/spacing/sm');
    expect(missingType).toBeDefined();
    expect(missingType!.message).toContain('$type');
  });

  it('rejects non-object input', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const tmp = resolve(fixtures, '_tmp_array.json');
    await writeFile(tmp, '[1, 2, 3]');
    try {
      const result = await validateDTCGTokenFile(tmp);
      expect(result.valid).toBe(false);
      expect(result.diagnostics[0].message).toContain('array');
    } finally {
      await unlink(tmp);
    }
  });

  it('rejects non-object value at non-$ key', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const tmp = resolve(fixtures, '_tmp_string_val.json');
    await writeFile(tmp, '{ "bad": "just a string" }');
    try {
      const result = await validateDTCGTokenFile(tmp);
      expect(result.valid).toBe(false);
      expect(result.diagnostics[0].path).toBe('/bad');
      expect(result.diagnostics[0].message).toContain('string');
    } finally {
      await unlink(tmp);
    }
  });

  it('rejects array value at non-$ key', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const tmp = resolve(fixtures, '_tmp_array_val.json');
    await writeFile(tmp, '{ "bad": [1, 2, 3] }');
    try {
      const result = await validateDTCGTokenFile(tmp);
      expect(result.valid).toBe(false);
      expect(result.diagnostics[0].path).toBe('/bad');
      expect(result.diagnostics[0].message).toContain('array');
    } finally {
      await unlink(tmp);
    }
  });

  it('collects errors from multiple tokens', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'invalid-tokens.json'));
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);
  });

  it('returns error for non-existent file', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'does-not-exist.json'));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('ENOENT');
  });

  it('returns error for malformed JSON', async () => {
    const result = await validateDTCGTokenFile(resolve(fixtures, 'malformed.json'));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('JSON');
  });
});
