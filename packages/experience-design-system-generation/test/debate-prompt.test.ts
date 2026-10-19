import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrompt, resolveSkillPath } from '../src/index.js';
import type { DebateRole, PromptOptions, Skill } from '../src/index.js';

const skill = 'debate-select' satisfies Skill;
const defaultRole: DebateRole = 'for';

describe('generation debate-select prompt', () => {
  it.each([
    { role: 'for' as const, participant: 'FOR' },
    { role: 'against' as const, participant: 'AGAINST' },
    { role: undefined, participant: 'FOR' },
  ])('sets the $participant role and required argument protocol', async ({ role, participant }) => {
    const options: PromptOptions = {
      skill,
      mode: 'autonomous',
      outDir: '/tmp/out',
      debateRole: role,
    };

    const prompt = await buildPrompt(options);

    expect(prompt).toContain(`You are the ${participant} participant`);
    expect(prompt).toContain(`"role":"${role ?? defaultRole}"`);
    expect(prompt).toContain('"disagreement_id"');
    expect(prompt).toContain('"argument"');
    expect(prompt).toContain('"evidence"');
    expect(prompt).toContain('source, line, and quote');
  });

  it('retains supplied disagreement, source, and existing-model context', async () => {
    const disagreement = '{"id":"d1","claim":"Card does not render a slot"}';
    const source = 'export function Card() { return <section><Badge /></section>; }';
    const prompt = await buildPrompt({
      skill,
      mode: 'autonomous',
      outDir: '/tmp/out',
      disagreementInline: disagreement,
      componentSourceRefs: [{ component: 'Card', sourcePath: 'src/Card.tsx', content: source }],
      existingModelPath: '/workspace/current-model.json',
    });

    expect(prompt).toContain(disagreement);
    expect(prompt).toContain('Disagreement under review (JSON)');
    expect(prompt).toContain('src/Card.tsx');
    expect(prompt).toContain(source);
    expect(prompt).toContain('## Existing ExO model');
    expect(prompt).toContain('/workspace/current-model.json');
    expect(prompt).toContain('source wins');
    expect(prompt).toContain('exactly one JSON object on one line');
  });

  it('resolves the primary flat skill asset used by package and CLI asset copying', async () => {
    const skillPath = resolveSkillPath(skill);
    expect(skillPath).toBe(resolve(import.meta.dirname, '../skills/debate-select.md'));
    await expect(readFile(skillPath, 'utf8')).resolves.toContain(
      'This skill is used after independent component-selection agents disagree',
    );
  });
});
