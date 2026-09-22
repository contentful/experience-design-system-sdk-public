import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentSupportsStdinPrompt, buildArgs, runAgent, shouldUseStdinPrompt } from '../src/agent-runner.js';

// Echoes back where the prompt arrived, so we can assert delivery rather than
// trusting the flag we passed in.
const STUB = `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n');
  process.stdout.write('STDIN_LEN:' + input.length + '\\n');
});
`;

// Larger than ARGV_PROMPT_LIMIT (4096) and than the Windows cmd.exe ceiling
// (8191). Roughly the size of the real generate-components skill prompt.
const BIG = 'x'.repeat(50_000);
const SMALL = 'summarise this';

let dir: string;
let stubPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prompt-delivery-'));
  stubPath = join(dir, 'stub.mjs');
  await writeFile(stubPath, STUB);
  await chmod(stubPath, 0o755);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('agentSupportsStdinPrompt', () => {
  it('covers the agents whose CLI reads a positional prompt', () => {
    expect(agentSupportsStdinPrompt('claude')).toBe(true);
    expect(agentSupportsStdinPrompt('codex')).toBe(true);
    expect(agentSupportsStdinPrompt('opencode')).toBe(true);
    expect(agentSupportsStdinPrompt('cursor')).toBe(true);
  });

  it('excludes copilot, whose -p requires the prompt as the flag value', () => {
    expect(agentSupportsStdinPrompt('copilot')).toBe(false);
  });
});

describe('shouldUseStdinPrompt', () => {
  it('routes a large prompt to stdin', () => {
    // The case that makes `generate components` impossible on Windows via argv.
    expect(shouldUseStdinPrompt('claude', BIG)).toBe(true);
  });

  it('leaves a small prompt on argv', () => {
    expect(shouldUseStdinPrompt('claude', SMALL)).toBe(false);
  });

  it('never routes copilot to stdin, however large the prompt', () => {
    expect(shouldUseStdinPrompt('copilot', BIG)).toBe(false);
  });
});

describe('buildArgs', () => {
  it('omits the prompt from argv when delivering on stdin', () => {
    const args = buildArgs('claude', BIG, undefined, true);
    expect(args).not.toContain(BIG);
    expect(args).toContain('--print');
    // The whole point: the command line stays far below the Windows 8191 ceiling.
    // (A default --model is always present, hence a length check not an exact match.)
    expect(args.join(' ').length).toBeLessThan(100);
  });

  it('puts the prompt in argv when not using stdin', () => {
    const args = buildArgs('claude', SMALL, undefined, false);
    expect(args).toContain(SMALL);
  });

  it('keeps the copilot prompt in argv even when stdin is requested', () => {
    // Honouring the request would emit a bare `-p` and lose the prompt entirely.
    const args = buildArgs('copilot', SMALL, undefined, true);
    expect(args).toContain(SMALL);
    expect(args.indexOf(SMALL)).toBe(args.indexOf('-p') + 1);
  });
});

describe('runAgent prompt delivery', () => {
  it('sends a large prompt on stdin without being asked', async () => {
    // The regression guard for Windows: a ~50KB prompt must not reach argv.
    process.env['EDS_AGENT_BINARY_CLAUDE'] = stubPath;
    try {
      const res = await runAgent({ agent: 'claude', prompt: BIG, timeoutMs: 20_000 });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(`STDIN_LEN:${BIG.length}`);
      // argv must carry flags only — never the prompt.
      const argvLine = res.stdout.split('\n').find((l) => l.startsWith('ARGV:')) ?? '';
      expect(argvLine).not.toContain('xxxx');
      expect(argvLine.length).toBeLessThan(120);
    } finally {
      delete process.env['EDS_AGENT_BINARY_CLAUDE'];
    }
  }, 30_000);

  it('still passes a small prompt on argv', async () => {
    process.env['EDS_AGENT_BINARY_CLAUDE'] = stubPath;
    try {
      const res = await runAgent({ agent: 'claude', prompt: SMALL, timeoutMs: 20_000 });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('STDIN_LEN:0');
      expect(res.stdout).toContain(SMALL);
    } finally {
      delete process.env['EDS_AGENT_BINARY_CLAUDE'];
    }
  }, 30_000);

  it('sends a large prompt on stdin for codex too', async () => {
    // Per-agent coverage: the argv shape differs (codex uses `exec`), and only
    // claude was covered before.
    process.env['EDS_AGENT_BINARY_CODEX'] = stubPath;
    try {
      const res = await runAgent({ agent: 'codex', prompt: BIG, timeoutMs: 20_000 });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(`STDIN_LEN:${BIG.length}`);
      expect(res.stdout).not.toContain('xxxxxxxxxx'); // prompt absent from argv
    } finally {
      delete process.env['EDS_AGENT_BINARY_CODEX'];
    }
  }, 30_000);

  it('sends a large prompt on stdin for opencode too', async () => {
    process.env['EDS_AGENT_BINARY_OPENCODE'] = stubPath;
    try {
      const res = await runAgent({ agent: 'opencode', prompt: BIG, timeoutMs: 20_000 });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(`STDIN_LEN:${BIG.length}`);
    } finally {
      delete process.env['EDS_AGENT_BINARY_OPENCODE'];
    }
  }, 30_000);

  it('keeps a large copilot prompt inline, since stdin is unsupported', async () => {
    process.env['EDS_AGENT_BINARY_COPILOT'] = stubPath;
    try {
      const res = await runAgent({ agent: 'copilot', prompt: BIG, timeoutMs: 20_000 });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('STDIN_LEN:0');
    } finally {
      delete process.env['EDS_AGENT_BINARY_COPILOT'];
    }
  }, 30_000);
});
