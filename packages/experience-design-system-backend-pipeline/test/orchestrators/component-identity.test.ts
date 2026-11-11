import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import * as sessionDb from '../../src/persistence/src/session/repositories/db.js';
import { runGenerateComponentsSession } from '../../src/orchestrators/run-generate-components-session/run-generate-components-session.js';
import { buildCDF, type ServerPreviewResponse } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  loadCDFComponents,
  loadRawComponents,
  openPipelineDb,
  storeCDFComponents,
  storeRawComponents,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
} from '../../src/persistence/src/session/repositories/db.js';
import { resolveComponentIds } from '../../src/persistence/src/session/services/component-identity.js';
import { annotatePreview } from '../../src/steps/apply/src/helpers/annotate-preview.js';

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
vi.mock('../../src/persistence/src/index.js', async (original) => ({
  ...(await original<object>()),
  loadAcceptedNames: async () => new Set(['Card', 'Panel', 'Badge']),
}));
vi.mock('../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js', () => ({
  runOneGenerateComponent: async (
    { db, sessionId }: { db: DatabaseSync; sessionId: string },
    component: { name: string },
  ) => {
    storeCDFComponents(db, sessionId, [
      {
        key: component.name,
        entry: {
          $type: 'component',
          $properties: {},
          ...(component.name.toLowerCase() === 'panel'
            ? {
                $slots: { children: { $allowedComponents: ['Card'] } },
              }
            : {}),
        },
      },
    ]);
    return { componentName: component.name, failed: false, renamedSlotsCount: 0 };
  },
}));

it.each([
  [['Card'], ['card'], ['card']],
  [['Card'], ['Card', 'card'], ['Card']],
  [['Card'], ['card', 'CARD'], ['Card']],
  [['Badge'], ['card'], ['Badge']],
  [['Card', 'card'], ['card'], ['Card', 'card']],
])('resolves %j against %j without ambiguous matches or collisions', (generated, existing, expected) => {
  expect([...resolveComponentIds(generated, existing).values()]).toEqual(expected);
});

describe('one persisted component ID', () => {
  it('persists one ID for generation, slots, review edits and resumed scope', async () => {
    const db = openPipelineDb(':memory:');
    const open = vi.spyOn(sessionDb, 'openPipelineDb').mockReturnValue(db);
    const close = vi.spyOn(db, 'close').mockImplementation(() => {});
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(
        db,
        sessionId,
        ['Card', 'Panel', 'Badge', 'Rejected'].map((name) => ({
          name,
          source: `src/${name}.tsx`,
          framework: 'react',
          props: [{ name: 'label', type: 'string', required: false }],
          slots: [],
        })),
      );
      const joinIds = loadRawComponents(db, sessionId).map((c) => c.component_id);
      const generate = () =>
        runGenerateComponentsSession({
          sessionId,
          agent: 'codex',
          promptOverrides: [],
          noCache: true,
          existingContentfulEntities: {
            components: ['card', 'panel'].map((id) => ({ sys: { id }, name: id })),
            tokens: [],
          } as never,
        });
      const document = () => buildCDF(loadCDFComponents(db, sessionId), []);
      expect((await generate()).results.map((r) => r.componentName)).toEqual(['Card', 'Panel', 'Badge']);
      expect(Object.keys(document()!).filter((key) => key !== '$schema')).toEqual(['card', 'panel', 'Badge']);
      expect(document()).toHaveProperty('panel.$slots.children.$allowedComponents', ['card']);
      expect(loadRawComponents(db, sessionId).map((c) => c.component_id)).toEqual(joinIds);
      const remote = {
        id: 'card',
        name: 'Card display name',
        contentProperties: ['label'],
        designProperties: [],
        slots: [],
        fullProperties: { label: { type: 'Symbol', category: 'content', required: false, default: 'Example' } },
      };
      expect(seedCDFFromPreviewResponse(db, sessionId, [remote])).toBe(1);
      expect(seedDefaultsFromChangedItems(db, sessionId, [{ current: remote, proposed: {} }])).toBe(1);
      expect(document()).toHaveProperty('card.$properties.label.$default', 'Example');
      storeCDFComponents(db, sessionId, [
        {
          key: 'panel',
          entry: {
            $type: 'component',
            $properties: {},
            $slots: { children: { $allowedComponents: ['card'] } },
          },
        },
      ]);
      expect(document()).toHaveProperty('panel.$slots.children.$allowedComponents', ['card']);
      expect((await generate()).results.map((r) => r.componentName)).toEqual(['card', 'panel', 'Badge']);
      expect(document()).toHaveProperty('panel.$slots.children.$allowedComponents', ['card']);
    } finally {
      open.mockRestore();
      close.mockRestore();
      db.close();
    }
  });

  it('uses IDs rather than display names for changed and removed preview annotations', () => {
    const summary = (id: string) => ({
      id,
      name: `${id} display name`,
      contentProperties: [],
      designProperties: [],
      slots: [],
    });
    const preview: ServerPreviewResponse = {
      components: {
        new: [],
        unchanged: [],
        changed: [
          {
            current: summary('card'),
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
          },
        ],
        removed: [summary('panel')],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
      taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
    };
    expect([...annotatePreview(preview, ['card', 'panel', 'Badge'])]).toEqual([
      ['card', 'changed'],
      ['panel', 'removed'],
      ['Badge', 'new'],
    ]);
  });
});
