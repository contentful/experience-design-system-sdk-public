import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawComponentDefinition } from '../../../src/steps/extraction/src/types/component.js';
const agent = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../../src/agents/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/agents/index.js')>()),
  createLocalCliAgentInvoker: () => ({
    invoke: async ({ prompt }: { prompt: string }) => {
      agent.prompts.push(prompt);
      return {
        stdout: [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'mode', reason: 'This fixture inspects advisory source evidence only' },
        ]
          .map((call) => JSON.stringify(call))
          .join('\n'),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    },
  }),
}));
import { buildCompilerEvidenceInline } from '../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';
import { runSelectionService } from '../../../src/steps/selection/src/services/run-selection-service.js';
import { runCdfGenerationService } from '../../../src/steps/generation/src/services/run-cdf-generation-service.js';
import { runExploreStage } from '../../../src/steps/exploration/src/services/run-explore-stage.js';

const component: RawComponentDefinition = {
  name: 'Panel',
  source: 'Panel.tsx',
  framework: 'react',
  props: [
    { name: 'mode', type: "'short' | 'long'", required: true, allowedValues: ['short', 'long'], defaultValue: 'short' },
  ],
  slots: [],
  factSchemaVersion: 4,
  sourceCandidates: [],
  componentFacts: {
    schemaVersion: 1,
    renderables: [
      {
        name: 'content',
        delivery: 'node-prop',
        elementTyped: null,
        sourceTypeText: 'string | Element',
        certainty: 'unknown',
        location: null,
      },
    ],
    referencedOrigins: [
      {
        name: 'Item',
        certainty: 'unknown',
        location: null,
        origin: { kind: 'unresolved', certainty: 'unknown', location: null },
      },
    ],
    nonStatic: [
      {
        kind: 'external-call',
        name: 'readValue',
        declaredIn: 'example.ts',
        packageName: 'example-package',
        certainty: 'ambiguous',
        location: null,
      },
    ],
  },
};
beforeEach(() => agent.prompts.splice(0));
describe('component evidence prompt channel', () => {
  it('routes scoped exploration facts separately and counts candidate-free suppression', async () => {
    const captured: Record<string, unknown>[] = [];
    const result = await runExploreStage({
      invoker: {
        invoke: async ({ prompt }) => {
          const scope = /"scope":"([^"\n]+)"/.exec(prompt)![1]!;
          captured.push(JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!));
          return {
            stdout: JSON.stringify({
              agentRole: scope,
              components: [{ name: 'Panel', source: 'Panel.tsx', included: true }],
            }),
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        },
      },
      agent: 'codex',
      scopes: ['components-1', 'components-6'],
      rawComponentsInline: JSON.stringify([component]),
      sourceInput: {
        files: [],
        observations: { accepted: ['caller'], rejected: ['rejection'] },
        omittedObservations: 3,
      } as never,
      outDir: '',
      timeoutMs: 1000,
      backoffMs: 0,
      skillContentOverride: 'Inspect source.',
    });
    expect(result.ok).toBe(true);
    expect((captured[0]!.components as Record<string, unknown>[])[0]!.componentFacts).toBeUndefined();
    expect(captured[0]!.componentEvidence).toMatchObject([{ status: 'available', facts: component.componentFacts }]);
    expect(captured[1]!.componentEvidence).toBeUndefined();
    expect(JSON.stringify(captured[1])).not.toContain('readValue');
    expect(captured[1]!.omittedComponentFacts).toBe(3);
    expect(captured[1]!.sourceInput).toMatchObject({
      observations: { accepted: [], rejected: [] },
      omittedObservations: 8,
    });
  });
  it('delivers all supported supplied facts through the typed evidence block independently of candidates', () => {
    const evidence = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }));
    expect(evidence.componentFacts[0]).toMatchObject({ status: 'available', facts: component.componentFacts });
    expect(evidence.sourceCandidates[0].status).toBe('available');
    const corruptCandidate = { ...component, sourceEvidenceReadStatus: 'corrupt' as const };
    expect(
      JSON.parse(buildCompilerEvidenceInline([corruptCandidate], { readiness: 'caller-provided' })).componentFacts[0]
        .status,
    ).toBe('available');
  });
  it.each(['ready', 'caller-provided', 'unavailable'] as const)('respects saved-source readiness: %s', (readiness) => {
    const saved = { ...component, componentEvidenceReadStatus: 'available' as const };
    const channel = JSON.parse(buildCompilerEvidenceInline([saved], { readiness })).componentFacts[0];
    expect(channel.status).toBe(readiness === 'unavailable' ? 'unavailable' : 'available');
    expect(channel.facts).toEqual(readiness === 'unavailable' ? null : component.componentFacts);
  });
  it.each(['corrupt', 'unsupported', 'unknown-legacy'] as const)(
    'does not expose component evidence with %s read status',
    (status) => {
      const channel = JSON.parse(
        buildCompilerEvidenceInline([{ ...component, componentEvidenceReadStatus: status }], { readiness: 'ready' }),
      ).componentFacts[0];
      expect(channel).toMatchObject({ status, facts: null });
    },
  );
  it('rejects unsupported and nonplain caller facts without hiding candidates', () => {
    for (const facts of [
      { schemaVersion: 99 },
      { schemaVersion: 1, compilerNode: {} },
      { schemaVersion: 1, renderables: [{}] },
    ]) {
      const evidence = JSON.parse(
        buildCompilerEvidenceInline([{ ...component, componentFacts: facts as never }], {
          readiness: 'caller-provided',
        }),
      );
      expect(evidence.componentFacts[0].facts).toBeNull();
      expect(evidence.sourceCandidates[0].status).toBe('available');
    }
  });
  it('omits component facts from raw selection and generation while preserving declared authoring fields', async () => {
    await runSelectionService({ components: [component], agent: 'claude', promptText: 'Select from source.' });
    await runCdfGenerationService({
      components: [component],
      agent: 'claude',
      skillContentOverride: 'Generate from source.',
    });
    expect(agent.prompts).toHaveLength(2);
    for (const prompt of agent.prompts) {
      const raw = prompt.match(/Raw component data \(JSON\):\n```json\n([\s\S]*?)\n```/)![1]!;
      expect(raw).not.toContain('componentFacts');
      expect(raw).not.toContain('referencedOrigins');
      expect(raw).toContain('short');
      expect(raw).toContain('long');
      expect(raw).toContain('required');
      const evidence = prompt.match(/Compiler evidence and source candidates[^\n]*\n```json\n([\s\S]*?)\n```/)![1]!;
      expect(JSON.parse(evidence).componentFacts[0].facts).toEqual(component.componentFacts);
    }
  });
});
