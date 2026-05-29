import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { validateCDFFile } from '../../../../src/print/validate/validators/cdf-validator.js';

const fixtures = resolve(import.meta.dirname, '../../../fixtures');

describe('validateCDFFile', () => {
  it('returns valid for a CDF file with nested groups and counts components', async () => {
    const result = await validateCDFFile(resolve(fixtures, 'valid-components.json'));
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary).toContain('2 components');
  });

  it('returns errors for invalid property $type', async () => {
    const result = await validateCDFFile(resolve(fixtures, 'invalid-components.json'));
    expect(result.valid).toBe(false);
    const typeError = result.diagnostics.find((d) => d.path.includes('$type') || d.actual === 'select');
    expect(typeError).toBeDefined();
    expect(typeError!.expected).toBeDefined();
  });

  it('returns errors for missing $category', async () => {
    const result = await validateCDFFile(resolve(fixtures, 'invalid-components.json'));
    expect(result.valid).toBe(false);
    const catError = result.diagnostics.find((d) => d.message.includes('$category') || d.path.includes('$category'));
    expect(catError).toBeDefined();
  });

  it('collects multiple errors', async () => {
    const result = await validateCDFFile(resolve(fixtures, 'invalid-components.json'));
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(1);
  });

  it('returns error for non-existent file', async () => {
    const result = await validateCDFFile(resolve(fixtures, 'does-not-exist.json'));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('ENOENT');
  });

  it('returns error for malformed JSON', async () => {
    const result = await validateCDFFile(resolve(fixtures, 'malformed.json'));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('JSON');
  });

  it('returns errors for missing $schema', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const tmp = resolve(fixtures, '_tmp_no_schema.json');
    await writeFile(
      tmp,
      JSON.stringify({
        Button: {
          $type: 'component',
          $properties: { label: { $type: 'string', $category: 'content' } },
        },
      }),
    );
    try {
      const result = await validateCDFFile(tmp);
      expect(result.valid).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    } finally {
      await unlink(tmp);
    }
  });
});
