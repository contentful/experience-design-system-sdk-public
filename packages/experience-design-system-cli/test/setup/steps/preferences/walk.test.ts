import { describe, expect, it, vi } from 'vitest';
import { runPreferenceSetupAction } from '../../../../src/setup/steps/preferences/index.js';
import type { SetupActionEvent } from '../../../../src/setup/lib/types.js';
import { createDependencies } from '../dependencies.js';

describe('preferences walk', () => {
  it('runs every preference in display order without asking which to configure', async () => {
    const dependencies = createDependencies({ ask: async () => '', confirm: async () => false });

    await expect(runPreferenceSetupAction(dependencies, '/home/tester/.zshrc')).resolves.toEqual({
      selected: ['autoFilter', 'concurrency', 'customPrompts', 'debug', 'analytics', 'noColor'],
    });
  });

  it('persists a changed preference collected through injected prompts', async () => {
    const writeCredentials = vi.fn();
    const dependencies = createDependencies({
      ask: async (question) => (question.includes('auto-filter') ? 'n' : ''),
      confirm: async () => false,
      writeCredentials,
    });

    await runPreferenceSetupAction(dependencies, '/home/tester/.zshrc');

    expect(writeCredentials).toHaveBeenCalledWith({
      spaceId: '',
      environmentId: '',
      cmaToken: '',
      autoFilter: false,
    });
  });

  it('opens each preference on its own page with help text describing what it does', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      ask: async () => '',
      confirm: async () => false,
      write: (event) => events.push(event),
    });

    await runPreferenceSetupAction(dependencies, '/home/tester/.zshrc');

    const help = events.filter((event) => event.kind === 'page').map((event) => event.message);
    expect(help).toEqual([
      'Filters out components irrelevant to experience orchestration during extraction.',
      'Analyzes more components at once, which is faster on machines with spare cores.',
      'Replaces the built-in instructions the coding agent follows when it selects and generates components.',
      'Writes a verbose trace of every command decision, for troubleshooting.',
      'Shares anonymous usage data about which CLI commands run.',
      'Prints plain text with no color, which suits CI logs and basic terminals.',
    ]);
  });

  it('asks about effects rather than the environment variables behind them', async () => {
    const questions: string[] = [];
    const dependencies = createDependencies({
      ask: async () => '',
      confirm: async (question) => {
        questions.push(question);
        return false;
      },
    });

    await runPreferenceSetupAction(dependencies, '/home/tester/.zshrc');

    expect(questions).toContain('Speed up component analysis on this machine?');
    expect(questions).toContain('Turn off colored output?');
    expect(questions).toContain('Use your own prompt files instead of the built-in ones?');
    expect(questions.join(' ')).not.toContain('NO_COLOR');
    expect(questions.join(' ')).not.toContain('EDS_EXTRACT_CONCURRENCY');
  });
});
