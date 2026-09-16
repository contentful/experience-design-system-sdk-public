import { describe, expect, it, vi } from 'vitest';
import {
  configureCustomPrompts,
  promptCustomSkillPathAction,
} from '../../../../src/setup/steps/preferences/custom-prompts.js';
import { createDependencies } from '../dependencies.js';

describe('promptCustomSkillPathAction', () => {
  it('returns the trimmed path when the operator supplies one', async () => {
    const ask = async () => '  /tmp/custom-select.md  ';
    const result = await promptCustomSkillPathAction('select', undefined, ask);
    expect(result).toBe('/tmp/custom-select.md');
  });

  it('returns undefined (keep current) when the operator presses Enter', async () => {
    const ask = async () => '';
    const result = await promptCustomSkillPathAction('generate', '/old/path.md', ask);
    expect(result).toBeUndefined();
  });

  it('returns null (clear) when the operator types "-"', async () => {
    const ask = async () => '-';
    const result = await promptCustomSkillPathAction('select', '/old/path.md', ask);
    expect(result).toBeNull();
  });

  it('shows the current value in the prompt question text', async () => {
    let asked = '';
    const ask = async (q: string) => {
      asked = q;
      return '';
    };
    await promptCustomSkillPathAction('generate', '/existing/path.md', ask);
    expect(asked).toContain('/existing/path.md');
    expect(asked).toContain('generate');
  });

  it('shows "[none]" when no current value is set', async () => {
    let asked = '';
    const ask = async (q: string) => {
      asked = q;
      return '';
    };
    await promptCustomSkillPathAction('select', undefined, ask);
    expect(asked).toContain('[none]');
  });
});

describe('configureCustomPrompts', () => {
  it('does nothing when the operator declines', async () => {
    const writeCredentials = vi.fn();
    await configureCustomPrompts(createDependencies({ confirm: async () => false, writeCredentials }));
    expect(writeCredentials).not.toHaveBeenCalled();
  });

  it('saves a supplied select path and clears a generate path on "-"', async () => {
    const writeCredentials = vi.fn();
    const answers = ['/tmp/select.md', '-'];
    await configureCustomPrompts(
      createDependencies({
        confirm: async () => true,
        ask: async () => answers.shift() ?? '',
        readCredentials: async () => ({
          spaceId: '',
          environmentId: '',
          cmaToken: '',
          generatePromptPath: '/old/generate.md',
        }),
        writeCredentials,
      }),
    );
    const saved = writeCredentials.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved['selectPromptPath']).toBe('/tmp/select.md');
    expect(saved).not.toHaveProperty('generatePromptPath');
  });
});
