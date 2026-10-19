import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectComponents } from '../../../src/steps/selection/src/controller/select-components-endpoint.js';
import { generateCdfComponents } from '../../../src/steps/generation/src/controller/generate-cdf-components-endpoint.js';
import { runOneGenerateComponent } from '../../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import {
  getOrCreateSession,
  loadRawComponents,
  openPipelineDb,
  storeRawComponents,
} from '../../../src/persistence/src/session/repositories/db.js';
import type { RawComponentDefinition } from '../../../src/steps/extraction/src/types/component.js';

const agent = vi.hoisted(() => ({ invoke: vi.fn(), checkAuth: vi.fn() }));
vi.mock('../../../src/agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => agent,
}));

const component: RawComponentDefinition = {
  name: 'Field',
  source: 'src/Field.tsx',
  framework: 'react',
  props: [
    {
      name: 'name',
      type: 'string',
      required: false,
      domAttribute: true,
      description: 'Form field name',
      defaultValue: 'contact',
    },
    { name: 'icon', type: 'string', required: false, domAttribute: false },
    { name: 'label', type: 'string', required: true },
    { name: 'unknown', type: '', required: false, domAttribute: true },
  ],
  slots: [{ name: 'children', isDefault: true }],
};

function assertPrompt(prompt: string): void {
  const raw = prompt.match(/Raw component data \(JSON\):\n```json\n([\s\S]*?)\n```/);
  expect(raw).not.toBeNull();
  const decoded = JSON.parse(raw![1]!);
  const components = Array.isArray(decoded) ? decoded : [decoded];
  expect(components).toHaveLength(1);
  expect(components[0].props).toEqual(component.props.map(({ domAttribute: _provenance, ...prop }) => prop));
  expect(components[0].slots).toEqual(component.slots);
  expect(prompt).not.toContain('"domAttribute"');
  const advisory = prompt.match(/Deterministic prop buckets[^\n]*:\n```json\n([\s\S]*?)\n```/);
  expect(advisory).not.toBeNull();
  const buckets = JSON.parse(advisory![1]!);
  expect(Array.isArray(buckets) ? buckets : [buckets]).toEqual([
    {
      component: 'Field',
      source: 'src/Field.tsx',
      customPropNames: ['icon', 'label'],
      domPassthroughPropNames: ['name'],
      otherPropNames: ['unknown'],
    },
  ]);
}

beforeEach(() => {
  agent.invoke.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
});

describe('production prompt provenance boundaries', () => {
  it('sends endpoint selection advisory buckets and clean raw definitions without mutating input', async () => {
    const original = structuredClone(component);
    agent.invoke.mockResolvedValue({
      stdout: '{"tool":"select_component","name":"Field"}',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const result = await selectComponents({ components: [component], promptText: 'Select visible UI.' });
    expect(result.selections[0]?.decision).toBe('accepted');
    assertPrompt(agent.invoke.mock.calls[0]![0].prompt);
    expect(component).toEqual(original);
  });

  it('sends endpoint generation advisory buckets and preserves classifications', async () => {
    const original = structuredClone(component);
    agent.invoke.mockResolvedValue({
      stdout:
        '{"tool":"classify_prop","component":"Field","prop":"label","cdf_type":"string","cdf_category":"content","required":true}',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const result = await generateCdfComponents({
      components: [component],
      skillContentOverride: 'Classify properties.',
    });
    expect(result.failures).toEqual([]);
    expect(result.components[0]?.$properties?.label).toMatchObject({ $type: 'string', $category: 'content' });
    assertPrompt(agent.invoke.mock.calls[0]![0].prompt);
    expect(component).toEqual(original);
  });

  it.each([false, true])(
    'derives session generation buckets from saved provenance with timeout=%s',
    async (timedOut) => {
      const db = openPipelineDb(':memory:');
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        storeRawComponents(db, sessionId, [component]);
        const stored = loadRawComponents(db, sessionId)[0]!;
        agent.invoke.mockResolvedValue({
          stdout: timedOut
            ? ''
            : '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true}',
          stderr: '',
          exitCode: 0,
          timedOut,
        });
        const result = await runOneGenerateComponent(
          {
            db,
            sessionId,
            invoker: agent,
            agent: 'claude',
            model: undefined,
            tokensInline: undefined,
            tokenMapInline: undefined,
            verbose: false,
            noCache: true,
            skillPathOverride: undefined,
            skillContentOverride: 'Classify properties.',
            promptHash: 'test',
            existingContentfulEntities: undefined,
            existingTokensInline: undefined,
            precomputedCachedNames: new Set(),
            allowedComponentNames: new Set(['Field']),
            onProgress: undefined,
          },
          stored,
          0,
          1,
        );
        expect(result.failed).toBe(timedOut);
        assertPrompt(agent.invoke.mock.calls[0]![0].prompt);
        expect(loadRawComponents(db, sessionId)[0]?.props).toEqual(component.props);
      } finally {
        db.close();
      }
    },
  );

  it('does not invoke agents for empty selection or generation inputs', async () => {
    await selectComponents({ components: [] });
    await generateCdfComponents({ components: [] });
    expect(agent.invoke).not.toHaveBeenCalled();
  });
});
