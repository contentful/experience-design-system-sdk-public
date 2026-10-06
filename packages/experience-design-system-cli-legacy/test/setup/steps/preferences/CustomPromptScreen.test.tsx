import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { ExperiencesCredentials } from '../../../../src/credentials-store.js';
import {
  CustomPromptsScreen,
  applyCustomSkillPath,
  customSkillPathQuestion,
  parseCustomSkillPath,
} from '../../../../src/setup/steps/preferences/CustomPromptScreen.js';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';

const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));

vi.mock('../../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.contentful/experience-design-system-cli/config.json',
}));

const EMPTY: ExperiencesCredentials = { spaceId: '', environmentId: '', cmaToken: '' };

function setup(stored: ExperiencesCredentials = EMPTY) {
  store.read.mockReset().mockResolvedValue(stored);
  store.write.mockReset().mockResolvedValue(undefined);
  const onDone = vi.fn();
  return { ...render(<CustomPromptsScreen onDone={onDone} />), onDone, write: store.write };
}

async function answer(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  if (text) stdin.write(text);
  await new Promise((resolve) => setTimeout(resolve, 40));
  stdin.write('\r');
  await new Promise((resolve) => setTimeout(resolve, 40));
}

describe('parseCustomSkillPath', () => {
  it('keeps the stored value on empty input', () => {
    expect(parseCustomSkillPath('')).toBeUndefined();
    expect(parseCustomSkillPath('   ')).toBeUndefined();
  });

  it('clears the stored value on "-"', () => {
    expect(parseCustomSkillPath('-')).toBeNull();
  });

  it('returns a trimmed path for anything else', () => {
    expect(parseCustomSkillPath('  /tmp/custom-generate.md  ')).toBe('/tmp/custom-generate.md');
  });
});

describe('customSkillPathQuestion', () => {
  it('shows the current value when one is stored', () => {
    const question = customSkillPathQuestion('/existing/path.md');
    expect(question).toContain('/existing/path.md');
    expect(question).toContain('generate');
  });

  it('shows [none] when nothing is stored', () => {
    expect(customSkillPathQuestion(undefined)).toContain('[none]');
  });
});

describe('applyCustomSkillPath', () => {
  it('sets the generate prompt path', () => {
    expect(applyCustomSkillPath(EMPTY, '/b.md')).toMatchObject({ generatePromptPath: '/b.md' });
  });

  it('deletes the field when the answer clears it', () => {
    const stored = { ...EMPTY, generatePromptPath: '/old.md' };
    expect(applyCustomSkillPath(stored, null)).not.toHaveProperty('generatePromptPath');
  });

  it('leaves the field untouched when the answer keeps it', () => {
    const stored = { ...EMPTY, generatePromptPath: '/old.md' };
    expect(applyCustomSkillPath(stored, undefined)).toMatchObject({ generatePromptPath: '/old.md' });
  });
});

describe('CustomPromptsScreen', () => {
  it('writes nothing when the operator declines', async () => {
    const { lastFrame, stdin, onDone, write } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt file'),
    );
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 80));

    expect(write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('asks only for the generate prompt path', async () => {
    const { lastFrame, stdin } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt file'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom generate'),
    );
    expect(frame).toContain('Replaces the built-in instructions');
    expect(frame).not.toContain('Custom select');
  });

  it('saves a supplied generate path', async () => {
    const { lastFrame, stdin, write, onDone } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt file'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom generate'),
    );
    await answer(stdin, '/tmp/generate.md');

    const saved = write.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved['generatePromptPath']).toBe('/tmp/generate.md');
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('clears a stored generate path on "-"', async () => {
    const { lastFrame, stdin, write } = setup({ ...EMPTY, generatePromptPath: '/old/generate.md' });
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt file'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom generate'),
    );
    await answer(stdin, '-');

    const saved = write.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('generatePromptPath');
  });
});
