import { describe, it, expect } from 'vitest';
import { runCli } from './cli-runner.js';

describe('runCli', () => {
  it('returns stdout with package name and code 0 for --help', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('experience-design-system-cli');
  });

  it('returns non-zero exit code for unknown command', async () => {
    const { code } = await runCli(['nonexistent']);
    expect(code).not.toBe(0);
  });
});
