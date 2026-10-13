import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateSession,
  openPipelineDb,
  storeCDFComponents,
  storeDTCGTokens,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  SAVE_CONFIRMATION_DELAY_MS,
  buildSavedCDF,
  recordRun,
  runPrintFiles,
  type RecordRunInput,
  type SaveDeps,
  type WriteFilesInput,
} from '../../../src/tui/import/steps/10-flow/flow/save.js';
import type { FlowPatch } from '../../../src/tui/import/steps/10-flow/flow/types.js';

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const raw = (name: string) => ({ name, source: `src/${name}.tsx`, framework: 'react' as const, props: [], slots: [] });

describe('buildSavedCDF', () => {
  it('refuses to save when there is nothing to save', () => {
    expect(() => buildSavedCDF([], [])).toThrow('nothing to save — no components or tokens resolved');
  });

  it('saves an empty document when told to delete everything, so the server shows what would go', () => {
    expect(buildSavedCDF([], [], { deleteAll: true })).toMatchObject({ $schema: 'https://contentful.com/schemas/cdf' });
  });

  it('refuses a document that does not validate, and says why', () => {
    const bad = { key: 'Bad', entry: { $type: 'component', $properties: { x: { $type: 'nonsense' } } } } as never;

    expect(() => buildSavedCDF([bad], [])).toThrow(/generated CDF failed validation: /);
  });
});

describe('the save step', () => {
  let dir: string;
  let previousDbPath: string | undefined;
  let sessionId: string;
  const readTokens = vi.fn();
  const sleep = vi.fn();
  const warn = vi.fn();
  const appendRun = vi.fn();
  const buildSourceFingerprint = vi.fn();
  const writeFileFake = vi.fn();
  const patches: FlowPatch[] = [];

  const deps = (overrides: Partial<SaveDeps> = {}): SaveDeps => ({
    openDb: openPipelineDb,
    readTokens,
    writeFile: writeFileFake,
    appendRun,
    buildSourceFingerprint,
    sleep,
    warn,
    ...overrides,
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flow-save-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const db = openPipelineDb();
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(db, sessionId, [raw('Button'), raw('Card')]);
    storeCDFComponents(db, sessionId, [
      { key: 'Button', entry },
      { key: 'Card', entry },
    ]);
    db.close();
    patches.length = 0;
    for (const fake of [readTokens, sleep, warn, appendRun, buildSourceFingerprint, writeFileFake]) fake.mockReset();
    readTokens.mockResolvedValue([]);
    sleep.mockResolvedValue(undefined);
    writeFileFake.mockResolvedValue(undefined);
    buildSourceFingerprint.mockResolvedValue({
      files: {},
      rawTokensPath: null,
      rawTokensMtime: null,
      rawTokensContentHash: null,
    });
    appendRun.mockResolvedValue({ id: 'run-7' });
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  describe('runPrintFiles', () => {
    const input = (overrides: Partial<WriteFilesInput> = {}): WriteFilesInput => ({
      extractSessionId: sessionId,
      outDir: '/out',
      ...overrides,
    });
    const run = (i: WriteFilesInput = input(), d: SaveDeps = deps()) =>
      runPrintFiles(i, d, (patch) => patches.push(patch));

    it('shows that it is writing, then writes components.json into the folder it was given', async () => {
      await run();

      expect(patches).toEqual([{ step: 'printing' }]);
      expect(writeFileFake).toHaveBeenCalledWith('/out/components.json', expect.any(String));
    });

    it('writes the components as one CDF document, indented, ending with a newline', async () => {
      await run();

      const written = writeFileFake.mock.calls[0][1] as string;
      expect(written.endsWith('\n')).toBe(true);
      expect(JSON.parse(written)).toMatchObject({
        $schema: 'https://contentful.com/schemas/cdf',
        Button: entry,
        Card: entry,
      });
      expect(written).toContain('\n  "Button"');
    });

    it('says what it wrote and where, in the singular and the plural', async () => {
      await run();
      expect(warn).toHaveBeenLastCalledWith('wrote /out/components.json (2 components, 0 tokens)\n');

      warn.mockReset();
      const db = openPipelineDb();
      db.prepare(`DELETE FROM raw_components WHERE session_id = ? AND name = 'Card'`).run(sessionId);
      db.close();
      readTokens.mockResolvedValue([{ path: 'color.a', $type: 'color', $value: '#000' }]);
      await run(input({ tokensPath: '/t.json' }));
      expect(warn).toHaveBeenLastCalledWith('wrote /out/components.json (1 component, 1 token)\n');
    });

    it('reads the tokens from the tokens file when no token session was reused', async () => {
      readTokens.mockResolvedValue([{ path: 'color.brand', $type: 'color', $value: '#06f' }]);

      await run(input({ tokensPath: '/t.json' }));

      expect(readTokens).toHaveBeenCalledWith('/t.json');
      expect(JSON.parse(writeFileFake.mock.calls[0][1] as string)).toMatchObject({
        color: { brand: { $type: 'color' } },
      });
    });

    it('reads the tokens from the token session instead when one was reused, and not the file', async () => {
      const db = openPipelineDb();
      const tokenSession = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
      storeDTCGTokens(db, tokenSession, [], [{ path: 'color.reused', $type: 'color', $value: '#fff' }]);
      db.close();

      await run(input({ tokenSessionId: tokenSession, tokensPath: '/t.json' }));

      expect(readTokens).not.toHaveBeenCalled();
      expect(JSON.parse(writeFileFake.mock.calls[0][1] as string)).toMatchObject({
        color: { reused: { $value: '#fff' } },
      });
    });

    it('goes to the print gate afterwards, with the path it wrote', async () => {
      const result = await run();

      expect(result).toEqual({ ok: true, patch: { step: 'print-gate', componentsPath: '/out/components.json' } });
    });

    it('goes straight on, with no gate, when it is part of a push', async () => {
      const result = await run(input({ skipGate: true }));

      expect(result).toEqual({ ok: true, patch: { componentsPath: '/out/components.json' } });
    });

    it('waits for the confirmation to be read before moving on', async () => {
      await run();

      expect(sleep).toHaveBeenCalledWith(SAVE_CONFIRMATION_DELAY_MS);
      expect(SAVE_CONFIRMATION_DELAY_MS).toBe(1000);
    });

    it('writes an empty document when told to delete everything and nothing is there', async () => {
      const db = openPipelineDb();
      db.prepare(`DELETE FROM raw_components WHERE session_id = ?`).run(sessionId);
      db.close();

      const result = await run(input({ allowEmpty: true }));

      expect(result.ok).toBe(true);
      expect(JSON.parse(writeFileFake.mock.calls[0][1] as string)).toEqual({
        $schema: 'https://contentful.com/schemas/cdf',
      });
    });

    it('fails with a message when there is nothing to write and that was not asked for', async () => {
      const db = openPipelineDb();
      db.prepare(`DELETE FROM raw_components WHERE session_id = ?`).run(sessionId);
      db.close();

      const result = await run();

      expect(result).toEqual({
        ok: false,
        patch: {
          step: 'error',
          errorStep: 'save CDF',
          errorMessage: 'nothing to save — no components or tokens resolved',
        },
      });
      expect(sleep).not.toHaveBeenCalled();
    });

    it('fails with the reason when the file cannot be written, and does not wait', async () => {
      writeFileFake.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await run();

      expect(result).toEqual({
        ok: false,
        patch: { step: 'error', errorStep: 'save CDF', errorMessage: 'EACCES: permission denied' },
      });
      expect(sleep).not.toHaveBeenCalled();
    });

    it('fails when the tokens file cannot be read', async () => {
      readTokens.mockRejectedValue(new Error('tokens.json is not valid JSON'));

      expect(await run(input({ tokensPath: '/t.json' }))).toMatchObject({
        ok: false,
        patch: { errorMessage: 'tokens.json is not valid JSON' },
      });
    });

    it('gives a generic message for something thrown that is not an error', async () => {
      writeFileFake.mockRejectedValue('nope');

      expect(await run()).toMatchObject({ ok: false, patch: { errorMessage: 'Unknown error' } });
    });

    it('writes nothing, and opens no database, without a session', async () => {
      const openDb = vi.fn(openPipelineDb);

      const result = await run(input({ extractSessionId: null, allowEmpty: true }), deps({ openDb }));

      expect(result.ok).toBe(true);
      expect(JSON.parse(writeFileFake.mock.calls[0][1] as string)).toEqual({
        $schema: 'https://contentful.com/schemas/cdf',
      });
    });
  });

  describe('recordRun', () => {
    const state: RecordRunInput['state'] = {
      extractSessionId: 'ext-1',
      rawTokensPath: '/raw/tokens.json',
      projectPath: '/proj',
      generatedAcceptedCount: 4,
      generatedCount: 9,
      tokenCount: 3,
      tokenSessionId: 'tok-1',
      tokensPath: '/out/tokens.json',
      agent: 'claude',
      generateSessionId: 'gen-1',
    };
    const record = (overrides: Partial<RecordRunInput['state']> = {}, d: SaveDeps = deps()) =>
      recordRun({ state: { ...state, ...overrides }, savePath: '/out' }, d);

    it('records the run and returns its id', async () => {
      expect(await record()).toBe('run-7');
      expect(appendRun).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: '/proj',
          savePath: '/out',
          componentCount: 4,
          tokenCount: 3,
          tokensPath: '/out/tokens.json',
          tokenSessionId: 'tok-1',
          agent: 'claude',
          pushedTo: null,
          extractSessionId: 'ext-1',
          generateSessionId: 'gen-1',
        }),
      );
    });

    it('counts the accepted components, and falls back to all the generated ones when none were counted', async () => {
      await record({ generatedAcceptedCount: 0, generatedCount: 9 });

      expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ componentCount: 9 }));
    });

    it('records no tokens file when the tokens were not reused from an earlier session', async () => {
      await record({ tokenSessionId: null });

      expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ tokensPath: null, tokenSessionId: null }));
    });

    it('records no tokens file when there is none, even for a reused session', async () => {
      await record({ tokensPath: '' });

      expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ tokensPath: null }));
    });

    it('fingerprints the sources, with the raw tokens file', async () => {
      await record();

      expect(buildSourceFingerprint).toHaveBeenCalledWith(
        expect.objectContaining({ extractSessionId: 'ext-1', rawTokensPath: '/raw/tokens.json' }),
      );
      expect(appendRun).toHaveBeenCalledWith(
        expect.objectContaining({ sourceFingerprint: expect.objectContaining({ files: {} }) }),
      );
    });

    it('passes no raw tokens file when there was none', async () => {
      await record({ rawTokensPath: '' });

      expect(buildSourceFingerprint).toHaveBeenCalledWith(expect.objectContaining({ rawTokensPath: null }));
    });

    it('records the run with no fingerprint, and warns, when fingerprinting fails', async () => {
      buildSourceFingerprint.mockRejectedValue(new Error('stat failed'));

      expect(await record()).toBe('run-7');
      expect(warn).toHaveBeenCalledWith('Warning: failed to compute source fingerprint: stat failed\n');
      expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ sourceFingerprint: null }));
    });

    it('does not fingerprint, and records an empty session id, without a session', async () => {
      await record({ extractSessionId: null });

      expect(buildSourceFingerprint).not.toHaveBeenCalled();
      expect(appendRun).toHaveBeenCalledWith(
        expect.objectContaining({ extractSessionId: '', sourceFingerprint: null }),
      );
    });

    it('returns nothing, and warns, when the run cannot be recorded', async () => {
      appendRun.mockRejectedValue(new Error('disk full'));

      expect(await record()).toBeNull();
      expect(warn).toHaveBeenCalledWith('Warning: failed to record run: disk full\n');
    });

    it('closes the database even when fingerprinting fails', async () => {
      const close = vi.fn();
      const openDb = vi.fn(() => ({ close }) as never);
      buildSourceFingerprint.mockRejectedValue(new Error('x'));

      await record({}, deps({ openDb }));

      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});

describe('the saved document on disk', () => {
  it('is what a real write produces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-save-real-'));
    try {
      const { writeFile } = await import('node:fs/promises');
      const cdf = buildSavedCDF([{ key: 'Button', entry }], []);
      await writeFile(join(dir, 'components.json'), `${JSON.stringify(cdf, null, 2)}\n`);

      expect(JSON.parse(await readFile(join(dir, 'components.json'), 'utf8'))).toEqual(cdf);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
