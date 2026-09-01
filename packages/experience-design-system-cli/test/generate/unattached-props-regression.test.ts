import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  applyToolCalls,
  loadCDFComponents,
} from '../../src/session/db.js';
import { CDF_V1_SCHEMA_URL, validateCDF } from '@contentful/experience-design-system-types';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'breadcrumb-regression-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('INTEG-4798 regression: breadcrumb-shaped component with framework pass-through props', () => {
  it('keeps every prop, classifies real props correctly, and lands pass-through props as unattached — none dropped, none leaked into content/design', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Breadcrumb',
          source: 'src/Breadcrumb.tsx',
          framework: 'react',
          props: [
            { name: 'items', type: 'BreadcrumbItem[]', required: true, category: 'content' },
            { name: 'separator', type: 'string', required: false, category: 'design' },
            { name: 'maxVisible', type: 'number', required: false, category: 'design' },
            { name: 'isCollapsed', type: 'boolean', required: false, category: 'state' },
            { name: 'className', type: 'string', required: false, category: 'design' },
            { name: 'onNavigate', type: '(item: BreadcrumbItem) => void', required: false, category: 'design' },
            { name: 'innerRef', type: 'React.RefObject<HTMLElement>', required: false, category: 'design' },
            { name: 'testId', type: 'string', required: false, category: 'design' },
          ],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Breadcrumb',
        [
          {
            tool: 'classify_prop',
            prop: 'items',
            cdf_type: 'string',
            cdf_category: 'content',
            required: true,
            description: 'Breadcrumb trail items',
            reason: 'core content',
          },
          {
            tool: 'classify_prop',
            prop: 'separator',
            cdf_type: 'string',
            cdf_category: 'design',
            required: false,
            description: 'Separator character between items',
            reason: 'design surface',
          },
          {
            tool: 'classify_prop',
            prop: 'maxVisible',
            cdf_type: 'number',
            cdf_category: 'design',
            required: false,
            description: 'Maximum visible breadcrumb items',
            reason: 'design surface',
          },
          {
            tool: 'classify_prop',
            prop: 'isCollapsed',
            cdf_type: 'boolean',
            cdf_category: 'state',
            required: false,
            default: false,
            description: 'Whether the breadcrumb is collapsed',
            reason: 'stateful, not marketer-configurable today',
          },
          { tool: 'exclude_prop', prop: 'className', reason: 'DOM pass-through — not marketer-configurable' },
          { tool: 'exclude_prop', prop: 'onNavigate', reason: 'callback function — framework internal' },
          { tool: 'exclude_prop', prop: 'innerRef', reason: 'ref — framework internal' },
          { tool: 'exclude_prop', prop: 'testId', reason: 'test id — framework internal' },
        ],
        [],
      );

      // applyToolCalls itself sets raw_components.status = 'generated' (db.ts:861),
      // so loadCDFComponents already sees this component — no separate store step needed.
      const [{ entry }] = loadCDFComponents(db, sessionId);

      // Nothing dropped: all 8 props are present.
      expect(Object.keys(entry.$properties)).toHaveLength(8);

      // Real props landed in the right category, untouched by this change.
      expect(entry.$properties.items?.$category).toBe('content');
      expect(entry.$properties.separator?.$category).toBe('design');
      expect(entry.$properties.maxVisible?.$category).toBe('design');
      expect(entry.$properties.isCollapsed?.$category).toBe('state');

      // Framework pass-through props landed as unattached, not content/design/state.
      for (const propName of ['className', 'onNavigate', 'innerRef', 'testId']) {
        expect(entry.$properties[propName]?.$category).toBe('unattached');
        // When required is false, $required is not set (it's omitted from the entry)
        expect(entry.$properties[propName]?.$required).not.toBe(true);
      }

      // The printed CDF is schema-valid.
      const result = validateCDF({ $schema: CDF_V1_SCHEMA_URL, Breadcrumb: entry });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      db.close();
    });
  });
});
