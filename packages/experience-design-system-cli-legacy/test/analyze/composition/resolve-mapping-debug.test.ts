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

  it('records the agent edges with their source, then the merged edges by provenance', async () => {
    const events = captureEvents();
    const runAgentFn = vi.fn(async () => '{"tool":"map_edge","parent":"Tabs","child":"Tab"}');

    await resolveMapping({ components: COMPONENTS, files: [{ path: 'm.ts', content: 'x' }], runAgentFn });

    const names = events.map((event) => event.name);
    expect(names).toEqual([
      'composition.pre-agent',
      'composition.agent-edges',
      'composition.merged',
      'composition.applied',
    ]);
    expect(events[0]?.payload).toMatchObject({ residueParents: ['Tabs', 'Tab', 'Card'], forceAgent: false });
    expect(events[1]?.payload).toMatchObject({
      reason: 'residue',
      acceptedEdges: [{ parent: 'Tabs', child: 'Tab', slot: null }],
    });
    expect(events[2]?.payload).toMatchObject({
      edgeCountsByProvenance: { agent: 1 },
      edges: [{ parent: 'Tabs', child: 'Tab', slot: null, provenance: 'agent' }],
    });
    expect(events[3]?.payload).toMatchObject({
      slots: [{ component: 'Tabs', slot: 'children', allowedComponents: ['Tab'] }],
    });
  });

  it('records why the agent was skipped when there are no files', async () => {
    const events = captureEvents();

    await resolveMapping({ components: COMPONENTS, files: [], runAgentFn: vi.fn() });

    expect(events.map((event) => event.name)).toContain('composition.agent-skipped');
    expect(events.map((event) => event.name)).not.toContain('composition.agent-edges');
  });
});
