import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CDFComponentEntry, ServerPreviewResponse } from '@contentful/experience-design-system-types';
import {
  ApiError,
  assignCDFComponentIds,
  getOrCreateSession,
  openPipelineDb,
  storeCDFComponents,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import { runPrintFiles } from '../../../src/tui/import/steps/10-flow/flow/save.js';
import { runPreview, type RunPreviewInput } from '../../../src/tui/import/steps/10-flow/flow/preview.js';
import { runLivePreview } from '../../../src/tui/import/steps/09-review/run-live-preview.js';
import { applyPreviewAnnotations } from '../../../src/tui/import/steps/09-review/preview-annotations.js';

const client = vi.hoisted(() => ({ previewImport: vi.fn(), getLastRequestId: () => undefined }));
vi.mock('@contentful/experience-design-system-backend-pipeline', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ImportApiClient: class {
    previewImport = client.previewImport;
    getLastRequestId = client.getLastRequestId;
  },
}));

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const panel: CDFComponentEntry = {
  ...entry,
  $slots: { children: { $allowedComponents: ['Card'] } },
};
const serverPreview: ServerPreviewResponse = {
  components: { new: [entry], changed: [], unchanged: ['card', 'panel'], removed: [] },
  tokens: { new: [], changed: [], unchanged: [], removed: [] },
  taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
};

describe('component identity through the import flow', () => {
  let dir: string;
  let sessionId: string;
  let existingEntitiesPath: string;
  let previousDbPath: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'import-component-ids-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    existingEntitiesPath = join(dir, '.existing-entities.json');
    await writeFile(
      existingEntitiesPath,
      JSON.stringify({ components: [{ sys: { id: 'card' } }, { sys: { id: 'panel' } }], tokens: [] }),
    );
    const db = openPipelineDb();
    try {
      sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
      storeRawComponents(
        db,
        sessionId,
        ['Card', 'Panel', 'Badge'].map((name) => ({
          name,
          source: `src/${name}.tsx`,
          framework: 'react' as const,
          props: [],
          slots: [],
        })),
      );
      assignCDFComponentIds(db, sessionId, ['card', 'panel']);
      storeCDFComponents(db, sessionId, [
        { key: 'Card', entry },
        { key: 'Panel', entry: panel },
        { key: 'Badge', entry },
      ]);
    } finally {
      db.close();
    }
    client.previewImport.mockReset().mockResolvedValue(serverPreview);
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  const expectedDocument = () => ({
    $schema: 'https://contentful.com/schemas/cdf',
    card: entry,
    panel: { ...panel, $slots: { children: { $allowedComponents: ['card'] } } },
    Badge: entry,
  });
  const previewInput = (): RunPreviewInput => ({
    state: { credentialsSkipped: false },
    extractSessionId: sessionId,
    tokensPath: '',
    spaceId: 'example-space',
    environmentId: 'example-environment',
    cmaToken: 'example-token',
    host: 'api.example.com',
    deleteAll: false,
  });
  const previewDeps = () => ({
    createClient: () => client,
    openDb: openPipelineDb,
    readTokens: vi.fn().mockResolvedValue([]),
    patchReviewState: vi.fn().mockResolvedValue({ missingNames: [] }),
    verboseErrors: false,
  });

  it('saves and previews the same resolved IDs, including the document used for push', async () => {
    const written = vi.fn();
    const result = await runPrintFiles(
      { extractSessionId: sessionId, outDir: dir },
      {
        openDb: openPipelineDb,
        readTokens: vi.fn(),
        writeFile: written,
        appendRun: vi.fn(),
        buildSourceFingerprint: vi.fn(),
        sleep: vi.fn(),
        warn: vi.fn(),
      },
      vi.fn(),
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(written.mock.calls[0]![1])).toEqual(expectedDocument());

    const preview = await runPreview(previewInput(), previewDeps());
    expect(client.previewImport).toHaveBeenCalledWith(expectedDocument());
    expect(preview.cdf).toEqual(expectedDocument());
  });

  it('uses resolved IDs for live preview while keeping review annotations keyed by source names', async () => {
    const result = await runLivePreview({
      sessionId,
      tokensPath: '',
      spaceId: 'example-space',
      environmentId: 'example-environment',
      cmaToken: 'example-token',
      host: 'api.example.com',
      generation: 1,
    });
    expect(client.previewImport).toHaveBeenCalledWith(expectedDocument());
    const annotations = applyPreviewAnnotations(result.response!, ['Card', 'Panel', 'Badge'], result.componentIds);
    expect([...annotations]).toEqual([['Badge', 'new']]);
  });

  it('keeps stored IDs after the existing-entity snapshot is deleted', async () => {
    await rm(existingEntitiesPath);
    const preview = await runPreview(previewInput(), previewDeps());
    expect(preview.cdf).toHaveProperty('card');
    expect(preview.cdf).not.toHaveProperty('Card');
  });

  it('keeps resolved IDs when server defaults cause a second preview', async () => {
    const card = { ...entry, $properties: { tone: { $type: 'string' as const, $category: 'design' as const } } };
    const db = openPipelineDb();
    try {
      storeRawComponents(db, sessionId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'tone', type: 'string', required: false }],
          slots: [],
        },
      ]);
      storeCDFComponents(db, sessionId, [{ key: 'Card', entry: card }]);
    } finally {
      db.close();
    }
    const changed = {
      current: {
        id: 'card',
        name: 'Friendly Card',
        contentProperties: [],
        designProperties: ['tone'],
        slots: [],
        fullProperties: { tone: { type: 'String', category: 'design', required: false, default: 'neutral' } },
      },
      proposed: card,
    };
    client.previewImport.mockResolvedValueOnce({
      ...serverPreview,
      components: { new: [], changed: [changed], unchanged: [], removed: [] },
    });

    const result = await runPreview(previewInput(), previewDeps());
    expect(client.previewImport).toHaveBeenCalledTimes(2);
    expect(client.previewImport.mock.calls[0]![0]).toHaveProperty('card');
    expect(client.previewImport.mock.calls[1]![0]).toHaveProperty('card.$properties.tone.$default', 'neutral');
    expect(result.cdf).toHaveProperty('card.$properties.tone.$default', 'neutral');
    expect(changed.current.name).toBe('Friendly Card');
  });

  it('maps server validation IDs back to source names so skipping still targets the right component', async () => {
    client.previewImport.mockRejectedValue(
      new ApiError(
        'preview failed: 422',
        422,
        JSON.stringify({
          details: {
            errors: [
              { path: 'manifest:components/panel/$slots/children/$allowedComponents', message: 'Unresolved reference' },
            ],
          },
        }),
      ),
    );
    const deps = previewDeps();
    const result = await runPreview(previewInput(), deps);
    expect(result.previewValidationErrors?.[0]?.componentName).toBe('Panel');
    expect(deps.patchReviewState).toHaveBeenCalledWith(sessionId, [
      expect.objectContaining({ componentName: 'Panel' }),
    ]);
  });
});
