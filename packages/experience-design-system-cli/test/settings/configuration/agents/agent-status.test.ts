import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inspectAgent,
  statusFromChecks,
  testAgent,
  type AgentCheck,
} from '../../../../src/tui/settings/configuration/agents/agent-status.js';

// These run real throwaway scripts instead of mocking the process layer. What matters: the path the user typed is the
// thing that gets run, the screen never tells a user a broken agent is ready, and a test leaves nothing behind.
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

  it('does not call a path ready when the file is missing or not executable', async () => {
    const missing = join(dir, 'missing');
    const plain = join(dir, 'plain-file');
    await writeFile(plain, 'not a program');

    expect(statusFromChecks('codex', await inspectAgent('codex', missing), missing)).toBe('not-found');
    expect(statusFromChecks('codex', await inspectAgent('codex', plain), plain)).toBe('not-found');
  });

  it('does not call an agent broken just because it does not answer --version', async () => {
    const path = await script('cursor-agent', 'exit 1');

    expect(statusFromChecks('cursor', await inspectAgent('cursor', path), path)).toBe('unknown');
  });

  it('does not spend a prompt on an agent that is not there', async () => {
    const checks = await testAgent('codex', join(dir, 'missing'), '');

    expect(checks.map((check) => check.step)).toEqual(['path']);
  });

  it('is ready only once the agent answers a real prompt, and runs the path that was typed', async () => {
    const path = await script(
      'codex',
      'case "$1" in --version) echo "codex 9.9.9";; *) cat >/dev/null; echo ok;; esac',
    );

    const checks = await testAgent('codex', path, '');

    expect(checks.at(-1)).toMatchObject({ step: 'prompt', ok: true });
    expect(statusFromChecks('codex', checks, path)).toBe('ready');
  });

  it('reports a failing agent as a failed test, with its own message', async () => {
    const path = await script('codex', 'case "$1" in --version) echo v;; *) echo "boom" >&2; exit 2;; esac');

    const checks = await testAgent('codex', path, '');

    expect(checks.at(-1)).toMatchObject({ step: 'prompt', ok: false, detail: 'boom' });
    expect(statusFromChecks('codex', checks, path)).toBe('test-failed');
  });

  it('does not leave the tested path behind in the environment', async () => {
    const path = await script('codex', 'case "$1" in --version) echo v;; *) cat >/dev/null; echo ok;; esac');
    delete process.env.EDS_AGENT_BINARY_CODEX;

    await testAgent('codex', path, '');

    expect(process.env.EDS_AGENT_BINARY_CODEX).toBeUndefined();
  });

  // The real timeout is 60s, so these build the checks a timeout and a passing login check would produce.
  describe('what a finished test says about the agent', () => {
    const found: AgentCheck[] = [
      { step: 'path', ok: true, detail: '/x/claude' },
      { step: 'version', ok: true, detail: '1.0.0' },
    ];

    it('does not call a claude that fails its test ready, even though its login check passed', () => {
      const checks: AgentCheck[] = [
        ...found,
        { step: 'login', ok: true, detail: 'logged in' },
        { step: 'prompt', ok: false, detail: 'Error: model not found' },
      ];

      expect(statusFromChecks('claude', checks, '')).toBe('test-failed');
    });

    it('reports a timeout as a timeout, not as a failed login', () => {
      const checks: AgentCheck[] = [
        ...found,
        { step: 'prompt', ok: false, detail: 'no answer within 60s', timedOut: true },
      ];

      expect(statusFromChecks('codex', checks, '')).toBe('timed-out');
    });
  });
});
