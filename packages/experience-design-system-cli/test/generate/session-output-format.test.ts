import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPipelineDb,
  storeRawComponents,
  getOrCreateSession,
  createStep,
  updateStep,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const RAW_COMPONENTS: RawComponentDefinition[] = [
  {
    name: 'Button',
    source: '/fake/src/Button.tsx',
    framework: 'react',
    props: [{ name: 'label', type: 'string', required: true, category: 'content' }],
    slots: [],
  },
];

async function seedDb(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, {
    command: 'analyze extract',
  });
  storeRawComponents(db, sessionId, RAW_COMPONENTS);
  const stepId = createStep(db, sessionId, 'analyze extract', { project: '/fake' });
  updateStep(db, stepId, 'complete', { sessionId });
  db.close();
  return sessionId;
}

/**
 * INTEG-4409: The wizard's `runGenerate` / `spawnGenerateChild` / `runExtract` all
 * parse the child stdout with `/^session=(.+)$/m`. `generate components` and
 * `generate tokens` MUST therefore emit `session=<id>`, matching the shape
 * produced by `analyze extract` / `analyze select`. Previously these commands
 * emitted `session: <id>` (colon-space), which caused `generateSessionId` to be
 * captured as `null` and cascaded into wrong-session errors downstream.
 */
describe('generate — session output format (INTEG-4409)', () => {
  it('generate components emits `session=<id>` (equals form) on stdout', async () => {
    const dbDir = await createTempDir('gen-session-fmt-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const fakeBinDir = await createTempDir('fake-bin-session-fmt-');
    await symlink(
      join(resolve(import.meta.dirname, '../fixtures/generate'), 'fake-agent-success.mjs'),
      join(fakeBinDir, 'claude'),
    );

    const { stdout, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });

    expect(code).toBe(0);

    // Contract with WizardApp.tsx:1010 (`runGenerate`) and :948 (`spawnGenerateChild`).
    const wizardRegex = /^session=(.+)$/m;
    const match = wizardRegex.exec(stdout);
    expect(match, `stdout did not match ${wizardRegex} — got:\n${stdout}`).not.toBeNull();
    expect(match?.[1]?.trim()).toBe(sid);

    // Guard against a regression to the colon form.
    expect(stdout).not.toMatch(/^session:\s/m);
  });

  it('generate tokens emits `session=<id>` (equals form) on stdout', async () => {
    const dbDir = await createTempDir('gen-tokens-session-fmt-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    // Seed an analyze-extract session so the tokens command can attach to it.
    await seedDb(dbPath);

    // Provide raw tokens file — required by `generate tokens`.
    const rawTokensPath = join(dbDir, 'raw-tokens.json');
    await writeFile(rawTokensPath, JSON.stringify({ colors: { primary: '#ff0000' } }));

    // Fake agent that emits a single set_token tool call (minimum for success).
    const fakeBinDir = await createTempDir('fake-bin-tokens-session-fmt-');
    const fakeAgent = join(fakeBinDir, 'claude');
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env node
process.stdout.write('{"tool":"set_token","path":"colors.primary","value":"#ff0000","type":"color"}\\n');
process.exit(0);
`,
    );
    await chmod(fakeAgent, 0o755);

    const { stdout, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'tokens', '--agent', 'claude', '--raw-tokens', rawTokensPath],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });

    expect(code).toBe(0);

    const wizardRegex = /^session=(.+)$/m;
    const match = wizardRegex.exec(stdout);
    expect(match, `stdout did not match ${wizardRegex} — got:\n${stdout}`).not.toBeNull();
    expect(match?.[1]?.trim()).toMatch(/^[a-z0-9-]+$/i);

    expect(stdout).not.toMatch(/^session:\s/m);
  });
});
