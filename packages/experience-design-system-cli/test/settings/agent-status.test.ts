import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultModelLabel,
  effectiveBinary,
  inspectAgent,
  nextStepHint,
  statusFromChecks,
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
      const checks = await inspectAgent('codex', join(dir, 'missing'));

      expect(statusFromChecks('codex', checks)).toBe('not-found');
      expect(checks).toHaveLength(1);
      expect(checks[0]?.detail).toContain('missing');
    });

    it('reads as not found when the file is not executable', async () => {
      const path = join(dir, 'plain-file');
      await writeFile(path, 'not a program');

      expect(statusFromChecks('codex', await inspectAgent('codex', path))).toBe('not-found');
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

      expect(statusFromChecks('codex', await inspectAgent('codex', path))).toBe('unknown');
    });

    it('is not reported as broken when it does not answer --version', async () => {
      const path = await script('cursor-agent', 'exit 1');

      const status = statusFromChecks('cursor', await inspectAgent('cursor', path));

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
      expect(statusFromChecks('codex', checks)).toBe('ready');
    });

    it('reports the agent’s own error when the prompt fails', async () => {
      const path = await script(
        'codex',
        'case "$1" in --version) echo "codex 9.9.9";; *) echo "Error: not signed in" >&2; exit 1;; esac',
      );

      const checks = await testAgent('codex', path, '');

      expect(checks.at(-1)).toMatchObject({ step: 'prompt', ok: false, detail: 'Error: not signed in' });
      expect(statusFromChecks('codex', checks)).toBe('not-logged-in');
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
      expect(nextStepHint('claude', 'not-found')).toContain('npm install');
      expect(nextStepHint('claude', 'not-logged-in')).toContain('claude login');
      expect(nextStepHint('claude', 'ready')).toBe('');
    });
  });
});
