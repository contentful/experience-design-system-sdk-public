import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMapping } from '../../../src/analyze/composition/resolve-mapping.js';
import * as debugLogger from '../../../src/lib/debug-logger.js';
import type { RawComponentDefinition, RawSlotDefinition } from '../../../src/types.js';

function comp(name: string, slots: RawSlotDefinition[] = []): RawComponentDefinition {
  return { name, source: '', framework: 'react', props: [], slots };
}

const defaultSlot = (): RawSlotDefinition => ({ name: 'children', isDefault: true });
const COMPONENTS = [comp('Tabs', [defaultSlot()]), comp('Tab'), comp('Card', [defaultSlot()])];

function captureEvents(): Array<{ name: string; payload: Record<string, unknown> }> {
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  vi.spyOn(debugLogger, 'getDebugLogger').mockReturnValue({
    enabled: true,
    path: null,
    event: (_category, name, payload = {}) => {
      events.push({ name, payload });
    },
  });
  return events;
}

describe('resolveMapping debug events', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the edges before the merge, the merged edges by provenance, and the applied slots', () => {
    const events = captureEvents();

    resolveMapping({
      components: COMPONENTS,
      sourceCallSiteEvidence: [
        {
          parent: 'Tabs',
          child: 'Tab',
          sourcePath: 'src/FeatureTabs.tsx',
          startLine: 8,
          endLine: 12,
          excerpt: '<Tab />',
          kind: 'jsx-render',
        },
      ],
      sourceCallSiteRejections: [
        { parent: 'Card', candidate: '<text>', sourcePath: 'src/Page.tsx', reason: 'text-only-child' },
      ],
    });

    expect(events.map((event) => event.name)).toEqual([
      'composition.pre-merge',
      'composition.merged',
      'composition.applied',
    ]);
    expect(events[0]?.payload).toMatchObject({
      edgeCountsByProvenance: { 'call-site': 1 },
      coveredParents: ['Tabs'],
      residueParents: ['Tab', 'Card'],
      sourceCallSiteAccepted: 1,
      sourceCallSiteRejected: 1,
    });
    expect(events[1]?.payload).toMatchObject({
      edgeCountsByProvenance: { 'call-site': 1 },
      edges: [{ parent: 'Tabs', child: 'Tab', slot: null, provenance: 'call-site' }],
    });
    expect(events[2]?.payload).toMatchObject({
      slots: [{ component: 'Tabs', slot: 'children', allowedComponents: ['Tab'] }],
    });
  });

  it('records no edges when nothing is collected', () => {
    const events = captureEvents();

    resolveMapping({ components: COMPONENTS });

    expect(events[0]?.payload).toMatchObject({ edgeCountsByProvenance: {}, coveredParents: [] });
    expect(events[1]?.payload).toMatchObject({ edges: [] });
  });
});
