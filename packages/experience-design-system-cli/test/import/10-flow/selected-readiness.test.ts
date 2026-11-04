import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  loadCDFComponents,
  exportCdfDocument,
} from '@contentful/experience-design-system-backend-pipeline';
import { seedCompleteEmptyComponents } from '../source-session-fixture.js';
import { runPrintFiles, realSaveDeps } from '../../../src/tui/import/steps/10-flow/flow/save.js';
import { runPreview } from '../../../src/tui/import/steps/10-flow/flow/preview.js';
import { runLivePreview } from '../../../src/tui/import/steps/09-review/run-live-preview.js';
import { finalizeReviewSession } from '../../../src/tui/import/steps/09-review/session.js';

const remote = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('@contentful/experience-design-system-backend-pipeline', async (original) => ({
  ...(await original<object>()),
  ImportApiClient: class {
    previewImport(cdf: unknown) {
      return remote.preview(cdf);
    }
  },
}));
let directory = '';
const previous = process.env.EDS_PIPELINE_DB_PATH;
afterEach(async () => {
  if (previous === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
  else process.env.EDS_PIPELINE_DB_PATH = previous;
  if (directory) await rm(directory, { recursive: true, force: true });
  remote.preview.mockReset();
});

it('uses one exact selected readiness boundary through actual wizard file, standalone export, local previews and finalization', async () => {
  directory = await mkdtemp(join(tmpdir(), 'selected-ready-'));
  process.env.EDS_PIPELINE_DB_PATH = join(directory, 'pipeline.db');
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  await seedCompleteEmptyComponents(db, sessionId, directory, ['Example', 'Other']);
  const chosen = loadCDFComponents(db, sessionId).find((component) => component.key === 'Example')!;
  const other = loadCDFComponents(db, sessionId).find((component) => component.key === 'Other')!;
  db.prepare('DELETE FROM raw_component_decisions WHERE session_id=? AND component_id=?').run(
    sessionId,
    other.componentId,
  );
  db.close();
  const selected = new Set([chosen.componentId]);
  const deps = { ...realSaveDeps(), sleep: async () => undefined, warn: vi.fn() };
  const saved = await runPrintFiles(
    { extractSessionId: sessionId, outDir: directory, selectedComponentIds: selected },
    deps,
    vi.fn(),
  );
  expect(saved.ok).toBe(true);
  const contents = await readFile(join(directory, 'components.json'), 'utf8');
  expect(JSON.parse(contents).Example).toEqual(chosen.entry);
  expect(Object.hasOwn(JSON.parse(contents), 'Other')).toBe(false);
  expect((await exportCdfDocument({ sessionId, componentIds: selected })).cdf).toMatchObject({ Example: chosen.entry });
  await expect(exportCdfDocument({ sessionId })).rejects.toThrow('not ready');
  const preview = {
    components: { new: [], changed: [], removed: [], unchanged: [] },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  };
  remote.preview.mockResolvedValue(preview);
  expect(
    finalizeReviewSession(sessionId, [
      { ...chosen, status: 'accepted' },
      { ...other, status: 'rejected' },
    ]),
  ).toEqual({ accepted: 1, rejected: 1, unresolved: 0 });
  const live = await runLivePreview({
    sessionId,
    tokensPath: '',
    spaceId: 'example',
    environmentId: 'example',
    cmaToken: 'example',
    host: 'example.com',
    generation: 1,
    selectedComponentIds: selected,
  });
  expect(live.response).toEqual(preview);
  expect(remote.preview.mock.calls[0]![0]).toMatchObject({ Example: chosen.entry });
  const api = vi.fn().mockResolvedValue(preview);
  const result = await runPreview(
    {
      state: { credentialsSkipped: false },
      extractSessionId: sessionId,
      tokensPath: '',
      spaceId: 'example',
      environmentId: 'example',
      cmaToken: 'example',
      host: 'example.com',
      deleteAll: false,
    },
    {
      createClient: () => ({ previewImport: api, getLastRequestId: () => undefined }),
      openDb: openPipelineDb,
      readTokens: async () => [],
      patchReviewState: vi.fn(),
      verboseErrors: false,
    },
  );
  expect(result.step).toBe('done');
  expect(api).toHaveBeenCalledOnce();
  const broken = openPipelineDb();
  broken
    .prepare('DELETE FROM raw_component_decisions WHERE session_id=? AND component_id=?')
    .run(sessionId, chosen.componentId);
  broken.close();
  expect(
    (
      await runPrintFiles(
        { extractSessionId: sessionId, outDir: directory, selectedComponentIds: selected },
        deps,
        vi.fn(),
      )
    ).ok,
  ).toBe(false);
  expect(await readFile(join(directory, 'components.json'), 'utf8')).toBe(contents);
  await expect(
    runLivePreview({
      sessionId,
      tokensPath: '',
      spaceId: 'example',
      environmentId: 'example',
      cmaToken: 'example',
      host: 'example.com',
      generation: 2,
      selectedComponentIds: selected,
    }),
  ).rejects.toThrow('not ready');
});
