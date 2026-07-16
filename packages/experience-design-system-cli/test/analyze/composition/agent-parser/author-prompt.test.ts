import { describe, it, expect } from 'vitest';
import { buildAuthorPrompt } from '../../../../src/analyze/composition/agent-parser/author-prompt.js';

const files = [{ path: 'src/mapping/tabs.ts', content: "new MappingContext('a').withParentType('b')" }];
const names = ['Tabs', 'Panel'];

describe('buildAuthorPrompt', () => {
  it('states the pure-function contract and the Edge shape', () => {
    const p = buildAuthorPrompt(files, names);
    expect(p).toMatch(/export default function/);
    expect(p).toMatch(/ctx/);
    expect(p).toMatch(/parent/);
    expect(p).toMatch(/child/);
  });

  it('forbids I/O / imports (sandbox constraints)', () => {
    const p = buildAuthorPrompt(files, names);
    expect(p).toMatch(/no (require|import|I\/O|network|fs)/i);
  });

  it('includes the candidate files and component names', () => {
    const p = buildAuthorPrompt(files, names);
    expect(p).toContain('src/mapping/tabs.ts');
    expect(p).toContain('withParentType');
    expect(p).toContain('Tabs');
    expect(p).toContain('Panel');
  });

  it('carries the evidence-grounding rules', () => {
    const p = buildAuthorPrompt(files, names);
    expect(p).toMatch(/evidence/i);
  });

  it('applies a custom instruction override when given', () => {
    const p = buildAuthorPrompt(files, names, 'CUSTOM PARSER RULES');
    expect(p).toContain('CUSTOM PARSER RULES');
  });
});
