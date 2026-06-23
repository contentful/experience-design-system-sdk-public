import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { getOrCreateSession, openPipelineDb, storeRawComponents } from '../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const tempDirs: string[] = [];
const origDbPath = process.env['EDS_PIPELINE_DB_PATH'];

async function withTempDb(run: (ctx: { dbPath: string }) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'run-live-preview-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  process.env['EDS_PIPELINE_DB_PATH'] = dbPath;
  try {
    await run({ dbPath });
  } finally {
    if (origDbPath === undefined) delete process.env['EDS_PIPELINE_DB_PATH'];
    else process.env['EDS_PIPELINE_DB_PATH'] = origDbPath;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeRaw(name: string): RawComponentDefinition {
  return { name, source: `// ${name}`, framework: 'react', props: [], slots: [] };
}

const SAMPLE_PREVIEW: ServerPreviewResponse = {
  components: { new: [], changed: [], removed: [], unchanged: [] },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
};

function seed(dbPath: string): string {
  const db = openPipelineDb(dbPath);
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, {
      command: 'analyze extract',
      inputPath: '/p',
    });
    storeRawComponents(db, sessionId, [makeRaw('Button')], { status: 'generated' });
    return sessionId;
  } finally {
    db.close();
  }
}

// Mocks for ImportApiClient — set via vi.mock factory
const previewImportMock = vi.fn();

vi.mock('../../../src/apply/api-client.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/apply/api-client.js')>(
    '../../../src/apply/api-client.js',
  );
  class MockImportApiClient {
    async previewImport(manifest: unknown): Promise<unknown> {
      return previewImportMock(manifest);
    }
  }
  return {
    ...actual,
    ImportApiClient: MockImportApiClient,
  };
});

beforeEach(() => {
  previewImportMock.mockReset();
});

describe('runLivePreview', () => {
  it('returns null and skips API call when cmaToken is missing', async () => {
    const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
    const result = await runLivePreview({
      sessionId: 'sess-1',
      tokensPath: '',
      spaceId: 'sp',
      environmentId: 'master',
      cmaToken: '',
      host: 'https://api.contentful.com',
      generation: 1,
    });
    expect(result).toEqual({ generation: 1, response: null });
    expect(previewImportMock).not.toHaveBeenCalled();
  });

  it('returns null when spaceId is missing', async () => {
    const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
    const result = await runLivePreview({
      sessionId: 'sess-1',
      tokensPath: '',
      spaceId: '',
      environmentId: 'master',
      cmaToken: 't',
      host: 'h',
      generation: 1,
    });
    expect(result.response).toBeNull();
    expect(previewImportMock).not.toHaveBeenCalled();
  });

  it('returns null when environmentId is missing', async () => {
    const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
    const result = await runLivePreview({
      sessionId: 'sess-1',
      tokensPath: '',
      spaceId: 'sp',
      environmentId: '',
      cmaToken: 't',
      host: 'h',
      generation: 1,
    });
    expect(result.response).toBeNull();
    expect(previewImportMock).not.toHaveBeenCalled();
  });

  it('with all creds: builds manifest and calls previewImport', async () => {
    await withTempDb(async ({ dbPath }) => {
      const sessionId = seed(dbPath);
      previewImportMock.mockResolvedValueOnce(SAMPLE_PREVIEW);
      const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
      const result = await runLivePreview({
        sessionId,
        tokensPath: '',
        spaceId: 'sp',
        environmentId: 'master',
        cmaToken: 't',
        host: 'https://api.contentful.com',
        generation: 7,
      });
      expect(previewImportMock).toHaveBeenCalledTimes(1);
      const manifest = previewImportMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(manifest).toHaveProperty('componentsManifest');
      expect(result.generation).toBe(7);
      expect(result.response).toBe(SAMPLE_PREVIEW);
    });
  });

  it('re-throws ApiError 401', async () => {
    await withTempDb(async ({ dbPath }) => {
      const sessionId = seed(dbPath);
      const { ApiError } = await import('../../../src/apply/api-client.js');
      previewImportMock.mockRejectedValueOnce(new ApiError('preview failed: 401', 401, ''));
      const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
      await expect(
        runLivePreview({
          sessionId,
          tokensPath: '',
          spaceId: 'sp',
          environmentId: 'master',
          cmaToken: 't',
          host: 'h',
          generation: 1,
        }),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  it('re-throws non-ApiError', async () => {
    await withTempDb(async ({ dbPath }) => {
      const sessionId = seed(dbPath);
      previewImportMock.mockRejectedValueOnce(new Error('boom'));
      const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
      await expect(
        runLivePreview({
          sessionId,
          tokensPath: '',
          spaceId: 'sp',
          environmentId: 'master',
          cmaToken: 't',
          host: 'h',
          generation: 1,
        }),
      ).rejects.toThrow(/boom/);
    });
  });

  it('throws TimeoutError when previewImport hangs past 15s', async () => {
    await withTempDb(async ({ dbPath }) => {
      const sessionId = seed(dbPath);
      vi.useFakeTimers();
      previewImportMock.mockImplementationOnce(() => new Promise(() => {}));
      const { runLivePreview, TimeoutError } = await import('../../../src/import/tui/runLivePreview.js');
      const promise = runLivePreview({
        sessionId,
        tokensPath: '',
        spaceId: 'sp',
        environmentId: 'master',
        cmaToken: 't',
        host: 'h',
        generation: 1,
      });
      // attach handler to prevent unhandled rejection
      const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(15001);
      await assertion;
      vi.useRealTimers();
    });
  });

  it('preserves the generation token through to the result', async () => {
    await withTempDb(async ({ dbPath }) => {
      const sessionId = seed(dbPath);
      previewImportMock.mockResolvedValue(SAMPLE_PREVIEW);
      const { runLivePreview } = await import('../../../src/import/tui/runLivePreview.js');
      const r1 = await runLivePreview({
        sessionId,
        tokensPath: '',
        spaceId: 'sp',
        environmentId: 'master',
        cmaToken: 't',
        host: 'h',
        generation: 42,
      });
      expect(r1.generation).toBe(42);
    });
  });
});
