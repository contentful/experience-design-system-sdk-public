import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';
const agent = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../../src/agents/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/agents/index.js')>()),
  createLocalCliAgentInvoker: () => ({
    invoke: async ({ prompt }: { prompt: string }) => {
      agent.prompts.push(prompt);
      return {
        stdout: prompt.includes('Generate from source.')
          ? '{"tool":"classify_component"}\n{"tool":"classify_prop","prop":"mode","cdf_type":"string","cdf_category":"content","values":["short","long"]}'
          : '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    },
  }),
}));
import { runSelectionService } from '../../../src/steps/selection/src/services/run-selection-service.js';
import { runCdfGenerationService } from '../../../src/steps/generation/src/services/run-cdf-generation-service.js';
import { runExploreStage } from '../../../src/steps/exploration/src/services/run-explore-stage.js';
import { buildCompilerEvidenceInline } from '../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';

it('routes real default observations through selection/generation/scoped exploration and measures candidate-free suppression', async () => {
  const root = mkdtempSync(join(tmpdir(), 'observation-channels-'));
  try {
    const path = join(root, 'Panel.tsx');
    writeFileSync(
      path,
      "declare function readValue(value: string): string; type Props = { mode: 'short' | 'long' }; export function Panel(props: Props) { return <div>{readValue(props.mode)}</div>; }",
    );
    const component = (await extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
    const collection = component.componentFacts!.sourceObservations!;
    agent.prompts.splice(0);
    await runSelectionService({ components: [component], agent: 'claude', promptText: 'Select from source.' });
    await runCdfGenerationService({
      components: [component],
      agent: 'claude',
      skillContentOverride: 'Generate from source.',
    });
    expect(agent.prompts).toHaveLength(2);
    for (const prompt of agent.prompts) {
      const raw = prompt.match(/Raw component data \(JSON\):\n```json\n([\s\S]*?)\n```/)![1]!;
      expect(raw).not.toContain('sourceObservations');
      expect(raw).not.toContain('componentFacts');
      const channel = prompt.match(/Compiler evidence and source candidates[^\n]*\n```json\n([\s\S]*?)\n```/)![1]!;
      expect(JSON.parse(channel).componentFacts[0].facts.sourceObservations).toEqual(collection);
    }
    const captured: Record<string, unknown>[] = [];
    const result = await runExploreStage({
      invoker: {
        invoke: async ({ prompt }) => {
          const scope = /"scope":"([^"\n]+)"/.exec(prompt)![1]!;
          captured.push(JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!));
          return {
            stdout: JSON.stringify({ agentRole: scope, components: [{ name: 'Panel', source: path, included: true }] }),
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        },
      },
      agent: 'codex',
      scopes: ['components-1', 'components-6'],
      rawComponentsInline: JSON.stringify([component]),
      sourceInput: { files: [], observations: { accepted: [], rejected: [] }, omittedObservations: 0 } as never,
      outDir: '',
      timeoutMs: 1000,
      backoffMs: 0,
      skillContentOverride: 'Inspect source.',
    });
    expect(result.ok).toBe(true);
    expect(captured[0]!.componentEvidence).toMatchObject([{ status: 'available', facts: component.componentFacts }]);
    expect((captured[0]!.components as Record<string, unknown>[])[0]!.componentFacts).toBeUndefined();
    expect(captured[1]!.componentEvidence).toBeUndefined();
    expect(captured[1]!.omittedComponentFacts).toBe(collection.observations.length);
    expect(JSON.stringify(captured[1])).not.toContain('readValue');
    const unavailable = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'unavailable' }));
    expect(unavailable.componentFacts[0]).toMatchObject({ status: 'unavailable', facts: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
