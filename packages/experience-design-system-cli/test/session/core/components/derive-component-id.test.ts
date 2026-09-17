import { describe, it, expect } from 'vitest';
import { deriveComponentId } from '../../../../src/session/core/components/derive-component-id.js';

describe('deriveComponentId', () => {
  it('is deterministic for the same inputs', () => {
    expect(deriveComponentId('Button', './src/Button.tsx')).toBe(deriveComponentId('Button', './src/Button.tsx'));
  });

  it('returns a 12-character lowercase hex string', () => {
    const id = deriveComponentId('Button', './src/Button.tsx');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when the name changes', () => {
    const a = deriveComponentId('Button', './src/x.tsx');
    const b = deriveComponentId('Card', './src/x.tsx');
    expect(a).not.toBe(b);
  });

  it('changes when the source path changes', () => {
    const a = deriveComponentId('Button', './src/a.tsx');
    const b = deriveComponentId('Button', './src/b.tsx');
    expect(a).not.toBe(b);
  });
});
