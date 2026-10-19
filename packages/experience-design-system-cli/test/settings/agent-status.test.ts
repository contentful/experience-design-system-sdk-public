import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultModelLabel,
  effectiveBinary,
  LIST_STATUS,
  inspectAgent,
  modelLine,
  nextStepHint,
  panelRows,
  resolvedPath,
  statusFromChecks,
  statusRows,
  testAgent,
} from '../../src/tui/settings/agents/agent-status.js';

// These run real throwaway scripts instead of mocking the process layer: what matters is that a path the user typed is
// the thing that gets run, and that "does not answer --version" is never reported as "not installed".
describe('checking an agent', () => {
  let dir: string;

  const script = async (name: string, body: string): Promise<string> => {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-status-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('a path that is not there', () => {
    it('reads as not found, and says which path', async () => {
      const missing = join(dir, 'missing');
      const checks = await inspectAgent('codex', missing);

      expect(statusFromChecks('codex', checks, missing)).toBe('not-found');
      expect(checks).toHaveLength(1);
      expect(checks[0]?.detail).toContain('missing');
    });

    it('reads as not found when the file is not executable', async () => {
      const path = join(dir, 'plain-file');
      await writeFile(path, 'not a program');

      expect(statusFromChecks('codex', await inspectAgent('codex', path), path)).toBe('not-found');
    });
  });

  describe('nothing saved and nothing on the PATH', () => {
    // A command name that cannot exist on anyone's PATH, so this does not depend on what the machine has installed.
    const MISSING_COMMAND = 'definitely-not-a-real-agent-command';

    it('reads as not configured, which is different from a saved path that does not work', async () => {
      process.env.EDS_AGENT_BINARY_CODEX = MISSING_COMMAND;
      try {
        const checks = await inspectAgent('codex', '');

        expect(statusFromChecks('codex', checks, '')).toBe('not-configured');
        expect(statusFromChecks('codex', checks, '/saved/but/wrong')).toBe('not-found');
      } finally {
        delete process.env.EDS_AGENT_BINARY_CODEX;
      }
    });
  });

  describe('the status rows on an agent’s screen', () => {
    it('shows only the command, as not configured, when nothing was found and nothing is saved', () => {
      const rows = statusRows('codex', [{ step: 'path', ok: false, detail: '`codex` was not found' }], '');

      expect(rows).toEqual([{ label: 'Command', value: 'not configured (not on the PATH)', tone: 'muted' }]);
    });

    it('says which saved path failed', () => {
      const rows = statusRows('codex', [{ step: 'path', ok: false, detail: '`/x/codex` was not found' }], '/x/codex');

      expect(rows).toEqual([{ label: 'Command', value: '`/x/codex` was not found', tone: 'bad' }]);
    });

    it('says login is not checked for an agent that cannot be checked, until the test confirms it', async () => {
      const path = await script('codex', 'case "$1" in --version) echo v;; *) cat >/dev/null; echo ok;; esac');

      const before = statusRows('codex', await inspectAgent('codex', path), path);
      const after = statusRows('codex', await testAgent('codex', path, ''), path);

      expect(before.find((row) => row.label === 'Login')).toMatchObject({ tone: 'muted' });
      expect(after.find((row) => row.label === 'Login')).toMatchObject({ value: 'confirmed by the test', tone: 'ok' });
    });
  });

  describe('the resolved path on the list', () => {
    it('is the path that was found, and empty when nothing was', async () => {
      const path = await script('codex', 'echo v');

      expect(resolvedPath(await inspectAgent('codex', path))).toBe(path);
      expect(resolvedPath(await inspectAgent('codex', join(dir, 'missing')))).toBe('');
      expect(resolvedPath(undefined)).toBe('');
    });
  });

  describe('the detail panel under the list', () => {
    const none = { binary: '', model: '' };

    it('tells the user how to get an agent that is not installed, with no version or model to show', () => {
      const rows = panelRows('codex', [{ step: 'path', ok: false, detail: '`codex` was not found' }], none);

      expect(rows.map((row) => row.label)).toEqual(['Command', 'Next']);
      expect(rows[0]).toMatchObject({ value: 'not found on your PATH', tone: 'muted' });
      expect(rows[1]?.value).toContain('npm install -g @openai/codex');
    });

    it('names the saved path when that is what failed', () => {
      const rows = panelRows('codex', [{ step: 'path', ok: false, detail: '`/x/codex` was not found' }], {
        binary: '/x/codex',
        model: '',
      });

      expect(rows[0]).toMatchObject({ value: '`/x/codex` was not found', tone: 'bad' });
      expect(rows[1]?.value).toContain('fix the command path');
    });

    it('shows the full path, version and model for an agent that runs', async () => {
      const path = await script('codex', 'echo "codex 9.9.9"');

      const rows = panelRows('codex', await inspectAgent('codex', path), { binary: path, model: '' });

      expect(rows.find((row) => row.label === 'Command')?.value).toBe(path);
      expect(rows.find((row) => row.label === 'Version')?.value).toBe('codex 9.9.9');
      expect(rows.find((row) => row.label === 'Model')?.value).toBe('chosen by the agent (built-in default)');
    });

    it('does not run anything while the checks have not come back', () => {
      expect(panelRows('claude', undefined, none)).toEqual([{ label: 'Command', value: 'checking...', tone: 'muted' }]);
    });
  });

  describe('the words on the list', () => {
    it('uses the same plain words for an agent that is missing, whether or not a path was saved', () => {
      expect(LIST_STATUS['not-configured'].text).toBe('not installed');
      expect(LIST_STATUS['not-found'].text).toBe('not installed');
    });

    it('marks a saved path that does not work as a problem, and nothing saved as just empty', () => {
      expect(LIST_STATUS['not-found'].tone).toBe('bad');
      expect(LIST_STATUS['not-configured'].tone).toBe('muted');
    });

    it('does not call an agent ready unless it was confirmed', () => {
      expect(LIST_STATUS.unknown.text).not.toContain('ready');
      expect(LIST_STATUS.ready.text).toBe('ready');
    });
  });

  describe('the model line', () => {
    it('shows the saved model as is, and says when it is the built-in default instead', () => {
      expect(modelLine('claude', 'sonnet')).toBe('sonnet');
      expect(modelLine('claude', '  ')).toBe('haiku (built-in default)');
    });
  });

  describe('an agent that runs', () => {
    it('shows its version', async () => {
      const path = await script('codex', 'echo "codex 9.9.9"');

      const checks = await inspectAgent('codex', path);

      expect(checks.find((check) => check.step === 'version')?.detail).toBe('codex 9.9.9');
    });

    it('is unknown, not ready, when its login cannot be checked', async () => {
      const path = await script('codex', 'echo "codex 9.9.9"');

      expect(statusFromChecks('codex', await inspectAgent('codex', path), path)).toBe('unknown');
    });

    it('is not reported as broken when it does not answer --version', async () => {
      const path = await script('cursor-agent', 'exit 1');

      const status = statusFromChecks('cursor', await inspectAgent('cursor', path), path);

      expect(status).not.toBe('not-found');
      expect(status).toBe('unknown');
    });
  });

  describe('the full test', () => {
    it('stops at the first problem instead of spending a prompt on a missing agent', async () => {
      const checks = await testAgent('codex', join(dir, 'missing'), '');

      expect(checks.map((check) => check.step)).toEqual(['path']);
    });

    it('is ready once the agent answers a real prompt', async () => {
      const path = await script(
        'codex',
        'case "$1" in --version) echo "codex 9.9.9";; *) cat >/dev/null; echo ok;; esac',
      );

      const checks = await testAgent('codex', path, '');

      expect(checks.at(-1)).toMatchObject({ step: 'prompt', ok: true });
      expect(statusFromChecks('codex', checks, path)).toBe('ready');
    });

    it('reports the agent’s own error when the prompt fails', async () => {
      const path = await script(
        'codex',
        'case "$1" in --version) echo "codex 9.9.9";; *) echo "Error: not signed in" >&2; exit 1;; esac',
      );

      const checks = await testAgent('codex', path, '');

      expect(checks.at(-1)).toMatchObject({ step: 'prompt', ok: false, detail: 'Error: not signed in' });
      expect(statusFromChecks('codex', checks, path)).toBe('not-logged-in');
    });

    it('does not leave the tested path behind in the environment', async () => {
      const path = await script('codex', 'case "$1" in --version) echo v;; *) cat >/dev/null; echo ok;; esac');
      delete process.env.EDS_AGENT_BINARY_CODEX;

      await testAgent('codex', path, '');

      expect(process.env.EDS_AGENT_BINARY_CODEX).toBeUndefined();
    });
  });

  describe('what the screen shows when nothing is set', () => {
    it('uses the saved path over the command name', () => {
      expect(effectiveBinary('claude', '/opt/bin/claude')).toBe('/opt/bin/claude');
      expect(effectiveBinary('claude', '   ')).toBe('claude');
      expect(effectiveBinary('cursor', '')).toBe('cursor-agent');
    });

    it('shows the model the agent really runs with, not "default"', () => {
      expect(defaultModelLabel('claude')).toBe('haiku');
      expect(defaultModelLabel('codex')).toBe('chosen by the agent');
      expect(defaultModelLabel('copilot')).toBe('chosen by the agent');
    });

    it('tells the user what to run next', () => {
      expect(nextStepHint('claude', 'not-configured')).toContain('npm install');
      expect(nextStepHint('claude', 'not-found')).toContain('fix the command path');
      expect(nextStepHint('claude', 'not-logged-in')).toContain('claude login');
      expect(nextStepHint('claude', 'ready')).toBe('');
    });
  });
});
