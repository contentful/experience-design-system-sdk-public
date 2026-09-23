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
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
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
    expect(parseCustomSkillPath('  /tmp/custom-select.md  ')).toBe('/tmp/custom-select.md');
  });
});

describe('customSkillPathQuestion', () => {
  it('shows the current value when one is stored', () => {
    const question = customSkillPathQuestion('generate', '/existing/path.md');
    expect(question).toContain('/existing/path.md');
    expect(question).toContain('generate');
  });

  it('shows [none] when nothing is stored', () => {
    expect(customSkillPathQuestion('select', undefined)).toContain('[none]');
  });
});

describe('applyCustomSkillPath', () => {
  it('sets the field for the matching kind', () => {
    expect(applyCustomSkillPath(EMPTY, 'select', '/a.md')).toMatchObject({ selectPromptPath: '/a.md' });
    expect(applyCustomSkillPath(EMPTY, 'generate', '/b.md')).toMatchObject({ generatePromptPath: '/b.md' });
  });

  it('deletes the field when the answer clears it', () => {
    const stored = { ...EMPTY, selectPromptPath: '/old.md' };
    expect(applyCustomSkillPath(stored, 'select', null)).not.toHaveProperty('selectPromptPath');
  });

  it('leaves the field untouched when the answer keeps it', () => {
    const stored = { ...EMPTY, selectPromptPath: '/old.md' };
    expect(applyCustomSkillPath(stored, 'select', undefined)).toMatchObject({ selectPromptPath: '/old.md' });
  });
});

describe('CustomPromptsScreen', () => {
  it('writes nothing when the operator declines', async () => {
    const { lastFrame, stdin, onDone, write } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt files'),
    );
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 80));

    expect(write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('keeps both prompt paths on the page that offered them', async () => {
    const { lastFrame, stdin } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt files'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    const selectFrame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom select'),
    );
    expect(selectFrame).toContain('Replaces the built-in instructions');

    await answer(stdin, '/tmp/select.md');
    const generateFrame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom generate'),
    );
    expect(generateFrame).toContain('Replaces the built-in instructions');
  });

  it('saves a supplied select path and clears a stored generate path on "-"', async () => {
    const { lastFrame, stdin, write } = setup({ ...EMPTY, generatePromptPath: '/old/generate.md' });
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Use your own prompt files'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom select'),
    );
    await answer(stdin, '/tmp/select.md');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Custom generate'),
    );
    await answer(stdin, '-');

    const saved = write.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved['selectPromptPath']).toBe('/tmp/select.md');
    expect(saved).not.toHaveProperty('generatePromptPath');
  });
});
