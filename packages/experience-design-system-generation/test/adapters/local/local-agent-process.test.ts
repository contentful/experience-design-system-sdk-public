import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent } from '../../../src/generate/adapters/local/local-agent-process.js';

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

describe('runAgent failure modes', () => {
  async function useBinary(source: string): Promise<void> {
    const path = join(dir, 'scripted.mjs');
    await writeFile(path, `#!/usr/bin/env node\n${source}\n`);
    await chmod(path, 0o755);
    process.env.EDS_AGENT_BINARY_CLAUDE = path;
  }

  afterEach(() => {
    process.env.EDS_AGENT_BINARY_CLAUDE = stubPath;
  });

  it('reports the exit code and stderr of a failing agent without marking it timed out', async () => {
    await useBinary('process.stderr.write("boom"); process.exit(3);');

    const res = await runAgent({ agent: 'claude', prompt: 'P', timeoutMs: 5_000 });

    expect(res).toMatchObject({ exitCode: 3, stderr: 'boom', timedOut: false });
  });

  it('kills an agent that outlives its timeout and flags the run as timed out', async () => {
    await useBinary('process.stdout.write("started"); setInterval(() => {}, 1000);');

    const res = await runAgent({ agent: 'claude', prompt: 'P', timeoutMs: 300 });

    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).toBe('started');
  });

  it('streams stdout chunks to onOutput as they arrive', async () => {
    await useBinary('process.stdout.write("one\\n"); process.stdout.write("two\\n");');
    const chunks: string[] = [];

    const res = await runAgent({ agent: 'claude', prompt: 'P', timeoutMs: 5_000, onOutput: (c) => chunks.push(c) });

    expect(chunks.join('')).toBe('one\ntwo\n');
    expect(res.stdout).toBe('one\ntwo\n');
  });

  it('resolves with a failed run instead of crashing when the binary does not exist', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(dir, 'does-not-exist');

    const res = await runAgent({ agent: 'claude', prompt: 'P', timeoutMs: 5_000 });

    expect(res.exitCode).toBe(1);
    expect(res.timedOut).toBe(false);
    expect(res.stderr).toContain('ENOENT');
  });
});
