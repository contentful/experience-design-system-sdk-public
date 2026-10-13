import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The real spawn runs `node <legacy cli> __generate components …`. A small script stands in for the CLI, so the real
// spawn and stream handling are exercised without booting it. What it does is chosen by the --session value.
const stand = vi.hoisted(() => ({ path: '' }));
vi.mock('../../../src/legacy/legacy-cli-path.js', () => ({ findLegacyCliPath: () => stand.path }));

import { spawnGenerate, type GenerateCommand } from '../../../src/tui/import/steps/08-generation/processes.js';

const command = (sessionId: string): GenerateCommand => ({
  sessionId,
  tokensPath: '',
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  existingEntitiesPath: null,
  cachedComponents: [],
});

describe('spawnGenerate', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spawn-generate-'));
    stand.path = join(dir, 'cli.js');
    await writeFile(
      stand.path,
      `const session = process.argv[process.argv.indexOf('--session') + 1];
if (session === 'ok') { process.stdout.write('session=gen-1\\n'); process.stderr.write('progress=generate:1/3:Foo\\n'); }
if (session === 'fail') { process.stderr.write('boom\\n'); process.exit(2); }
if (session === 'split') { process.stderr.write('progress=generate:1/'); setTimeout(() => process.stderr.write('3:Foo\\n'), 30); }
if (session === 'none') { process.exit(0); }
`,
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves with the exit code, stdout and stderr on a clean exit', async () => {
    const result = await spawnGenerate(command('ok'), { onStderr: () => {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('session=gen-1');
    expect(result.stderr).toContain('progress=generate:1/3:Foo');
  });

  it('resolves with a non-zero exit code and the error output when the command fails', async () => {
    const result = await spawnGenerate(command('fail'), { onStderr: () => {} });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('boom');
  });

  it('hands stderr over as it arrives, so progress can be shown while it runs', async () => {
    const chunks: string[] = [];
    await spawnGenerate(command('ok'), { onStderr: (chunk) => chunks.push(chunk) });
    expect(chunks.join('')).toContain('progress=generate:1/3:Foo');
  });

  it('delivers stderr in the chunks the child wrote, even when a line arrives in pieces', async () => {
    const chunks: string[] = [];
    await spawnGenerate(command('split'), { onStderr: (chunk) => chunks.push(chunk) });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('progress=generate:1/3:Foo\n');
  });

  it('resolves with an empty result for a command that prints nothing', async () => {
    expect(await spawnGenerate(command('none'), { onStderr: () => {} })).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('resolves with a failure, instead of throwing, when the command cannot be started', async () => {
    stand.path = join(dir, 'does-not-exist.js');
    const result = await spawnGenerate(command('ok'), { onStderr: () => {} });
    stand.path = join(dir, 'cli.js');
    // node starts, cannot load the script and exits non-zero with its own error on stderr
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
