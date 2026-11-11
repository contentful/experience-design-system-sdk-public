import type { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCDF, type CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  loadCDFComponents,
  openPipelineDb,
  storeCDFComponents,
  storeRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { runGenerateComponentsSession } from '../../src/orchestrators/run-generate-components-session/run-generate-components-session.js';
import { exportCdfDocument } from '../../src/steps/generation/src/controller/export/export-cdf-document.js';
import { buildCDF as buildBackendCDF, validateSlotReferences } from '../../src/steps/shared/cdf/helpers/build.js';

vi.mock('../../src/agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({}),
}));
vi.mock('../../src/orchestrators/run-generate-components-session/helpers/resolve-generate-prompt.js', () => ({
  resolveGeneratePrompt: async () => ({}),
}));
vi.mock('../../src/persistence/src/session/helpers/cache-keys.js', async (original) => ({
  ...(await original<object>()),
  hashPromptForSkill: async () => 'example-prompt',
}));
vi.mock('../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js', () => ({
  runOneGenerateComponent: async (
    { db, sessionId }: { db: DatabaseSync; sessionId: string },
    component: { name: string },
  ) => {
    storeCDFComponents(db, sessionId, [{ key: component.name, entry: componentEntry(component.name) }]);
    return {
      componentName: component.name,
      failed: false,
      cached: false,
      renamedSlotsCount: 0,
      classified: 0,
      excluded: 0,
      slots: 0,
      warnings: [],
    };
  },
}));

function componentEntry(name: string): CDFComponentEntry {
  return {
    $type: 'component',
    $properties: {},
    ...(name === 'Panel' ? { $slots: { children: { $allowedComponents: ['Card'] } } } : {}),
  };
}

describe('canonical component identity at generation', () => {
  let dir: string;
  let sessionId: string;
  let oldDbPath: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canonical-component-id-'));
    oldDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const db = openPipelineDb();
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(
      db,
      sessionId,
      ['Card', 'Panel', 'Badge'].map((name) => ({
        name,
        source: `src/${name}.tsx`,
        framework: 'react',
        props: [],
        slots: [],
      })),
    );
    db.close();
  });

  afterEach(async () => {
    if (oldDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = oldDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  const generate = (ids: string[]) =>
    runGenerateComponentsSession({
      sessionId,
      agent: 'codex',
      promptOverrides: [],
      noCache: true,
      existingContentfulEntities: { components: ids.map((id) => ({ sys: { id }, name: id })), tokens: [] } as never,
    });

  it('persists IDs and slot references before any save or preview', async () => {
    await generate(['card', 'panel']);
    const db = openPipelineDb();
    const components = loadCDFComponents(db, sessionId);
    expect(components.map((component) => component.key)).toEqual(['Card', 'Panel', 'Badge']);
    expect(buildCDF(components, [])).toHaveProperty('panel.$slots.children.$allowedComponents', ['card']);
    expect(buildCDF(components, [])).toHaveProperty('card');
    expect(buildCDF(components, [])).toHaveProperty('Badge');
    expect(
      db.prepare("SELECT cdf_id FROM raw_components WHERE session_id = ? AND name = 'Card'").get(sessionId),
    ).toMatchObject({ cdf_id: 'card' });
    expect(
      db
        .prepare('SELECT allowed_component, cdf_id FROM raw_slot_allowed_components WHERE session_id = ?')
        .all(sessionId),
    ).toEqual([{ allowed_component: 'Card', cdf_id: 'card' }]);
    db.close();
  });

  it('preserves assigned IDs when generation resumes with a different snapshot or narrower scope', async () => {
    await generate(['card', 'panel']);
    await generate(['CARD', 'PANEL']);
    const db = openPipelineDb();
    const components = loadCDFComponents(db, sessionId).filter((component) => component.key === 'Panel');
    expect(buildCDF(components, [])).toHaveProperty('panel.$slots.children.$allowedComponents', ['card']);
    db.close();
  });

  it('preserves canonical IDs when a review edit replaces slot references', async () => {
    await generate(['card', 'panel']);
    const db = openPipelineDb();
    storeCDFComponents(db, sessionId, [{ key: 'Panel', entry: componentEntry('Panel') }]);
    expect(buildCDF(loadCDFComponents(db, sessionId), [])).toHaveProperty('panel.$slots.children.$allowedComponents', [
      'card',
    ]);
    db.close();
  });

  it('retains generated IDs when matches are ambiguous', async () => {
    await generate(['card', 'CARD']);
    const db = openPipelineDb();
    const document = buildCDF(loadCDFComponents(db, sessionId), []);
    expect(document).toHaveProperty('Card');
    expect(document).not.toHaveProperty('card');
    expect(document).toHaveProperty('Badge');
    db.close();
  });

  it('exports and validates the same canonical IDs through backend entrypoints', async () => {
    await generate(['card', 'panel']);
    const db = openPipelineDb();
    const components = loadCDFComponents(db, sessionId);
    expect(buildBackendCDF(components, [])).toHaveProperty('panel.$slots.children.$allowedComponents', ['card']);
    expect(validateSlotReferences(components)).toEqual([]);
    db.close();
    expect((await exportCdfDocument({ sessionId })).cdf).toHaveProperty('card');
  });

  it('retains generated IDs when no existing components are available', async () => {
    await generate([]);
    const db = openPipelineDb();
    expect(buildCDF(loadCDFComponents(db, sessionId), [])).toHaveProperty('Panel.$slots.children.$allowedComponents', [
      'Card',
    ]);
    db.close();
  });

  it('does not merge two generated definitions into the same persisted ID', async () => {
    const db = openPipelineDb();
    storeRawComponents(
      db,
      sessionId,
      ['Card', 'CARD'].map((name) => ({ name, source: `src/${name}.tsx`, framework: 'react', props: [], slots: [] })),
    );
    db.close();
    await generate(['card']);
    const reopened = openPipelineDb();
    expect(Object.keys(buildCDF(loadCDFComponents(reopened, sessionId), [])!)).toEqual(['$schema', 'Card', 'CARD']);
    const accepted = loadCDFComponents(reopened, sessionId).filter((component) => component.key === 'Card');
    expect(buildCDF(accepted, [])).toHaveProperty('Card');
    expect(buildCDF(accepted, [])).not.toHaveProperty('card');
    reopened.close();
  });

  it('persists external slot IDs and leaves ambiguous external references unchanged', async () => {
    await generate(['card', 'panel', 'external', 'ambiguous', 'AMBIGUOUS']);
    const db = openPipelineDb();
    storeCDFComponents(db, sessionId, [
      {
        key: 'Panel',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { children: { $allowedComponents: ['EXTERNAL', 'Ambiguous'] } },
        },
      },
    ]);
    expect(buildCDF(loadCDFComponents(db, sessionId), [])).toHaveProperty('panel.$slots.children.$allowedComponents', [
      'external',
      'Ambiguous',
    ]);
    db.close();
  });

  it('adds identity storage to a pre-existing database without changing source names', async () => {
    const db = openPipelineDb();
    storeCDFComponents(db, sessionId, [{ key: 'Card', entry: componentEntry('Card') }]);
    db.exec('ALTER TABLE raw_components DROP COLUMN cdf_id');
    db.exec('ALTER TABLE raw_slot_allowed_components DROP COLUMN cdf_id');
    db.exec('DROP TABLE session_component_identity');
    db.close();
    const migrated = openPipelineDb();
    expect(buildCDF(loadCDFComponents(migrated, sessionId), [])).toHaveProperty('Card');
    migrated.close();
    await generate(['card', 'panel']);
    const reopened = openPipelineDb();
    expect(buildCDF(loadCDFComponents(reopened, sessionId), [])).toHaveProperty('card');
    expect(loadCDFComponents(reopened, sessionId).map((component) => component.key)).toContain('Card');
    reopened.close();
  });
});
