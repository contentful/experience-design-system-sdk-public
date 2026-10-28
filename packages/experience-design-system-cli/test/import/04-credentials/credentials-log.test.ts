import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The debug store reads the settings when it is imported, so the test loads a fresh copy under its own EDS_HOME.
describe('the Credentials debug log', () => {
  let home: string;
  let base: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'eds-home-'));
    base = await mkdtemp(join(tmpdir(), 'eds-base-'));
    process.env['EDS_HOME'] = home;
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ debugMode: { enabled: true }, contentfulBaseDir: base }),
    );
  });

  afterEach(async () => {
    // each fresh copy of the store registers its own crash handlers on the process
    for (const event of ['uncaughtException', 'unhandledRejection', 'SIGINT'] as const)
      process.removeAllListeners(event);
    delete process.env['EDS_HOME'];
    await rm(home, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  });

  // This is the one import log that sits next to a secret, so what must hold is that the CMA token never reaches the
  // file: not as a value, and not inside an API error that echoes what it was sent.
  it('never writes the CMA token, not as a value and not inside an API error that echoes it', async () => {
    vi.resetModules();
    const store = await import('../../../src/tui/debug-store.js');
    const { credentialsLog, credentialsOutputs, rejectedAttempt } =
      await import('../../../src/tui/import/steps/04-credentials/logic.js');
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());

    const token = 'CFPAT-s3cr3t/abc+def=';
    const credentials = { spaceId: 'space1', environmentId: 'master', cmaToken: token, host: 'api.contentful.com' };
    const attempts = [
      rejectedAttempt(
        `401 Unauthorized for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`,
        credentials,
      ),
    ];

    store.startDebugRun({
      flow: 'import/credentials',
      step: '04-credentials',
      menuOption: 'Credentials',
      inputs: { import_mode: 'both', prefilled: true, ...credentialsLog({ ...credentials, cmaToken: '' }) },
    });
    await vi.waitFor(async () => {
      await store.finishDebugRun({
        outputs: {
          ...credentialsOutputs({
            outcome: 'back',
            credentials,
            initial: { ...credentials, cmaToken: '' },
            attempts,
          }),
          error: attempts[0]!.reason,
        },
        status: 'error',
        exitMethod: 'discarded',
      });
      expect(existsSync(store.currentDebugSessionDir()!)).toBe(true);
      expect(await readdir(store.currentDebugSessionDir()!, { recursive: true })).toContainEqual(
        expect.stringMatching(/credentials.*\.md$/),
      );
    });

    const file = (await readdir(store.currentDebugSessionDir()!, { recursive: true })).find((name) =>
      name.endsWith('.md'),
    )!;
    const log = await readFile(join(store.currentDebugSessionDir()!, file), 'utf8');

    expect(log).not.toContain(token);
    expect(log).not.toContain(encodeURIComponent(token));
    // It still says a token was set and how long it was, and what was rejected, so a truncated paste can be spotted.
    expect(log).toContain(`[present, ${token.length} chars]`);
    expect(log).toContain('401 Unauthorized for [redacted]');
  });
});
