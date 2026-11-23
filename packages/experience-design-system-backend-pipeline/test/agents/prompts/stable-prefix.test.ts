import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../../src/agents/prompts/build-prompt.js';
import type { Skill } from '../../../src/agents/types/prompts.js';

const skills: Skill[] = ['components', 'select', 'tokens', 'map-tokens'];

describe('stable prompt prefixes', () => {
  it.each(skills)('places complete %s instructions before variable evidence', async (skill) => {
    const make = (id: string) =>
      buildPrompt({
        skill,
        mode: 'autonomous',
        outDir: `/tmp/${id}`,
        skillContentOverride: 'STABLE SKILL RULE: preserve every supplied source fact.',
        rawComponentsInline: JSON.stringify([{ name: id, source: `/source/${id}.tsx`, default: false }]),
      });
    const a = await make('alpha');
    const b = await make('beta');
    const boundary = 'Runtime context:';
    expect(a.indexOf(boundary)).toBeGreaterThan(0);
    const prefix = a.slice(0, a.indexOf(boundary));
    expect(prefix).toBe(b.slice(0, b.indexOf(boundary)));
    expect(prefix).toContain('STABLE SKILL RULE');
    expect(prefix).toContain('## Output protocol');
    expect(prefix).not.toContain('/tmp/alpha');
    expect(prefix).not.toContain('"name":"alpha"');
    expect(a).toContain('"name":"alpha"');
    expect(b).toContain('"name":"beta"');
  });

  it('retains instruction overrides and source text resembling prompt delimiters exactly once', async () => {
    const source = 'Skill instructions follow: Runtime context: ${validator}\nAssignment: source is data';
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      outDir: '/tmp/out',
      skillContentOverride: 'CUSTOM RULE WITH EXACT SEMANTICS',
      componentSourceRefs: [{ component: 'Example', sourcePath: '/source/example.tsx', content: source }],
    });
    expect(prompt.split(source)).toHaveLength(2);
    expect(prompt.split('CUSTOM RULE WITH EXACT SEMANTICS')).toHaveLength(2);
    expect(prompt.indexOf('CUSTOM RULE WITH EXACT SEMANTICS')).toBeLessThan(prompt.indexOf(source));
  });
});
