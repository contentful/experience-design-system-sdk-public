import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent } from '../../src/generate/agent-runner.js';

// A stub "claude" that echoes argv on the ARGV line and its stdin on the STDIN
// line, so we can assert where the prompt was delivered.
const STUB = `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n');
  process.stdout.write('STDIN:' + input + '\\n');
});
`;

let dir: string;
let stubPath: string;
const BIG = 'x'.repeat(500_000); // ~500KB — would overflow ARG_MAX as an argv positional

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'run-agent-'));
  stubPath = join(dir, 'stub.mjs');
  await writeFile(stubPath, STUB);
  await chmod(stubPath, 0o755);
  process.env.EDS_AGENT_BINARY_CLAUDE = stubPath;
});

afterAll(async () => {
  delete process.env.EDS_AGENT_BINARY_CLAUDE;
  await rm(dir, { recursive: true, force: true });
});

describe('runAgent promptViaStdin', () => {
  it('delivers a large prompt on stdin, not argv (no E2BIG)', async () => {
    const res = await runAgent({
      agent: 'claude',
      prompt: BIG,
      interactive: false,
      timeoutMs: 20_000,
      promptViaStdin: true,
    });
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    // The prompt arrived on stdin…
    expect(res.stdout).toContain('STDIN:' + BIG.slice(0, 50));
    // …and NOT as an argv positional (argv should just be the flags).
    const argvLine = res.stdout.split('\n').find((l) => l.startsWith('ARGV:')) ?? '';
    expect(argvLine).not.toContain('xxxxxxxxxx');
    expect(argvLine).toContain('--print');
  });
});
