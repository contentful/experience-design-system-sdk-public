import { preflightGenerationResult, readGenerationContext } from '../../generation-fixture.js';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureSourceEvidence, extractEndpoint } from '../../../src/steps/extraction/index.js';
import { extractComponents } from '../../../src/steps/extraction/src/controller/extract-components-endpoint.js';
import * as saved from '../../../src/persistence/src/session/repositories/db.js';
import { buildCompilerEvidenceInline } from '../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';
import { buildExplorationSourceInput } from '../../../src/orchestrators/run-exploration-session/helpers/build-source-input.js';
import { runExploreStage } from '../../../src/steps/exploration/src/services/run-explore-stage.js';
import { runOneGenerateComponent } from '../../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import { projectAcceptedRawSlots } from '../../../src/steps/exploration/src/services/project-accepted-slots.js';
const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-contract-endpoints-')));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const producers = [
  ['public', extractEndpoint],
  ['backend', extractComponents],
] as const;
const declarations = `import type { PropType } from 'vue'; export type Names='first'|'second'; export enum Values { Low=0, High=8 }; export const common={names:String as PropType<Names>, numeric:Number as PropType<Values>, label:{type:String,default:''}, mixed:String as PropType<Names|number>, unrelated:String as Array<'pretend'>}; export function options(){const props={...common,count:Number};return {props};}`;
for (const [owner, extract] of producers) {
  it.each(['vue', 'tsx', 'jsx'])(
    `${owner} keeps configured imported domains and declaration-backed helper output in %s`,
    async (extension) => {
      const source =
        extension === 'vue'
          ? `<script setup lang="ts">import {common} from './props.js'; defineProps({...common,count:Number});</script>`
          : `import {defineComponent as create} from 'vue'; import {options} from './props.js';export const Example=create(options());`;
      const root = fixture({ 'props.ts': declarations, [`Example.${extension}`]: source });
      const result = await extract({ filePaths: [join(root, `Example.${extension}`)], projectRoot: root });
      const c = result.components.find((c) => c.framework === 'vue')!;
      expect(c.props.map((p) => p.name)).toEqual(['count', 'label', 'mixed', 'names', 'numeric', 'unrelated']);
      expect(c.sourceCandidates?.find((c) => c.name === 'names')?.facts).toMatchObject({
        sourceTypeText: 'Names',
        domain: {
          openness: 'closed',
          observedLiterals: [
            { kind: 'string', value: 'first' },
            { kind: 'string', value: 'second' },
          ],
        },
      });
      expect(c.sourceCandidates?.find((c) => c.name === 'numeric')?.facts?.domain.observedLiterals).toEqual([
        { kind: 'number', value: '0' },
        { kind: 'number', value: '8' },
      ]);
      for (const name of ['mixed', 'unrelated'])
        expect(c.sourceCandidates?.find((c) => c.name === name)?.facts?.domain.openness).not.toBe('closed');
      expect(c.sourceCandidates?.find((c) => c.name === 'label')?.facts?.declarations).toContainEqual(
        expect.objectContaining({ canonicalPath: join(root, 'props.ts') }),
      );
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    },
  );
  it('preserves unbound helper candidates with explicit uncertain binding on the actual endpoint', async () => {
    const root = fixture({ 'Example.tsx': `export const Example=defineComponent({props:{label:String}});` });
    const result = await extract({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
    expect(
      result.components.find((c) => c.framework === 'vue')?.sourceCandidates?.find((c) => c.name === 'label')?.facts
        ?.certainty,
    ).toBe('unknown');
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-component-binding-unresolved' }),
    );
  });
  it('retains repeated declarations and rejects parameter/branch/cycle certainty without execution', async () => {
    const root = fixture({
      'Example.tsx': `import {defineComponent} from 'vue';function values(){return {label:String};} function parameter(value:unknown){return value;}function branch(){if(unknownFlag)return {invented:Number};return {};}function cycle(){return cycle();}export const Example=defineComponent({props:{...values(),...values(),...parameter({pretend:String}),...branch(),...cycle()}});throw new Error('never execute source');`,
    });
    const result = await extract({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
    const c = result.components.find((c) => c.framework === 'vue')!.sourceCandidates!;
    expect(
      c.find((c) => c.name === 'label')?.observations.filter((o) => o.evidenceKind === 'declaration'),
    ).toHaveLength(2);
    expect(c.some((c) => c.name === 'invented' || c.name === 'pretend')).toBe(false);
    expect(
      result.extractionDiagnostics?.modules.filter((m) => m.reason === 'vue-runtime-call-unresolved'),
    ).toHaveLength(3);
  });
}
it('retains all source channels through cold saved slot/value/reference consumers while decisions own projection', async () => {
  const source = `<script setup lang="ts">import {useSlots} from 'vue';import {common} from './props.js';defineProps({...common});defineSlots<{heading(value:{label:string}):unknown}>();const slots=useSlots();slots.heading;slots[dynamic];</script><template><slot name="heading" v-if="visible">fallback body</slot><slot :name="dynamic"/></template>`;
  const root = fixture({ 'Example.vue': source, 'props.ts': declarations });
  const path = join(root, 'Example.vue');
  const result = await extractComponents({ filePaths: [path], projectRoot: root });
  const component = result.components[0]!;
  expect(component.slots.every((slot) => !slot.allowedComponents?.length)).toBe(true);
  const dbPath = join(root, 'pipeline.db');
  let db = saved.openPipelineDb(dbPath);
  const { sessionId } = saved.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = saved.createStep(db, sessionId, 'analyze extract', { project: root });
  saved.storeRawComponents(db, sessionId, result.components, { extractionDiagnostics: result.extractionDiagnostics });
  expect(saved.loadCompletedSourceEvidence(db, sessionId).readiness).toBe('unavailable');
  const row = saved.loadRawComponents(db, sessionId)[0]!;
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [path],
    components: [{ componentId: row.component_id, name: row.name, sourcePath: path }],
  });
  const handle = saved.completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: result.components,
    capture,
    cycles: [],
    scannedFiles: [path],
    observations: { accepted: [], rejected: [] },
    extractionDiagnostics: result.extractionDiagnostics,
  });
  db.close();
  rmSync(path);
  rmSync(join(root, 'props.ts'));
  db = saved.openPipelineDb(dbPath);
  try {
    const raw = saved.loadRawComponents(db, sessionId)[0]!,
      envelope = saved.loadCompletedSourceEvidence(db, sessionId, handle),
      diagnostics = saved.loadExtractionSourceDiagnostics(db, sessionId);
    expect(envelope.readiness).toBe('ready');
    if (envelope.readiness !== 'ready' || diagnostics.status !== 'available')
      throw new Error('Unavailable saved source');
    const heading = raw.sourceCandidates!.find((c) => c.name === 'heading')!;
    expect(heading.observations.map((o) => (o.syntax?.reader === 'vue' ? o.syntax.channel : undefined))).toEqual(
      expect.arrayContaining(['slot-contract', 'slot-template', 'slot-access']),
    );
    expect(
      heading.observations.some((o) => o.syntax?.reader === 'vue' && o.syntax.conditions.length && o.syntax.fallback),
    ).toBe(true);
    expect(
      raw.sourceCandidates!.some(
        (c) =>
          c.name.startsWith('@slot:') &&
          c.observations.some((o) => o.syntax?.reader === 'vue' && o.syntax.resolution === 'unresolved'),
      ),
    ).toBe(true);
    const input = buildExplorationSourceInput(envelope.envelope, diagnostics);
    const prompts: string[] = [];
    const explored = await runExploreStage({
      agent: 'codex',
      outDir: '',
      timeoutMs: 1000,
      backoffMs: 0,
      maxAttempts: 1,
      scopes: ['components-2', 'components-3'],
      rawComponentsInline: JSON.stringify([raw]),
      requestedComponents: [{ name: raw.name, source: raw.source, componentId: raw.component_id }],
      sourceInput: input,
      rendererReferenceInline: 'Declared source observations.',
      skillContentOverride: 'Use slot, value and reference provenance.',
      invoker: {
        invoke: async ({ prompt }) => {
          prompts.push(readGenerationContext(prompt));
          const scope = /"scope":"([^"]+)"/.exec(prompt)![1];
          return preflightGenerationResult(
            prompt,
            {
              stdout: JSON.stringify({
                agentRole: scope,
                components: [
                  {
                    name: raw.name,
                    source: raw.source,
                    componentId: raw.component_id,
                    included: false,
                    props: [],
                    slots: [],
                  },
                ],
              }),
              stderr: '',
              exitCode: 0,
              timedOut: false,
            },
            true,
          );
        },
      },
    });
    expect(explored.ok).toBe(true);
    for (const prompt of prompts) {
      for (const channel of ['slot-contract', 'slot-template', 'slot-access'])
        expect(prompt).toContain(`"channel":"${channel}"`);
      expect(prompt).toContain('fallback body');
      expect(prompt).toContain('"openness":"closed"');
      expect(prompt).toContain('dynamic-name');
    }
    const inline = buildCompilerEvidenceInline([raw], {
      readiness: 'ready',
      diagnostics: diagnostics.diagnostics,
      diagnosticsStatus: 'available',
    });
    const generationPrompts: string[] = [];
    const generated = await runOneGenerateComponent(
      {
        db,
        sessionId,
        invoker: {
          checkAuth: async () => 'ok',
          invoke: async ({ prompt }) => {
            generationPrompts.push(readGenerationContext(prompt));
            return preflightGenerationResult(
              prompt,
              {
                stdout: [
                  { tool: 'classify_component' },
                  { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' },
                  ...[
                    ...new Set([
                      ...raw.props.map((prop) => prop.name),
                      ...raw
                        .sourceCandidates!.filter((candidate) => candidate.keyPath.length === 1)
                        .map((candidate) => candidate.name),
                    ]),
                  ]
                    .filter((name) => name !== 'label')
                    .map((prop) => ({
                      tool: 'exclude_prop',
                      prop,
                      reason: 'Unsupported source channel retained by this fixture',
                    })),
                  ...raw.slots.map((slot) => ({ tool: 'classify_slot', slot: slot.name })),
                ]
                  .map((call) => JSON.stringify(call))
                  .join('\n'),
                stderr: '',
                exitCode: 0,
                timedOut: false,
              },
              true,
            );
          },
        },
        agent: 'codex',
        model: undefined,
        tokensInline: undefined,
        tokenMapInline: undefined,
        verbose: false,
        noCache: true,
        skillPathOverride: undefined,
        skillContentOverride: 'Preserve source alternatives.',
        promptHash: 'vue-contract-probe',
        existingContentfulEntities: undefined,
        existingTokensInline: undefined,
        compilerEvidenceInline: inline,
        precomputedCachedNames: new Set(),
        allowedComponentNames: new Set(['Example']),
        onProgress: undefined,
      },
      raw,
      0,
      1,
    );
    expect(generated.failed).toBe(true);
    expect(generated.error).toContain('Source inadequate');
    expect(generationPrompts[0]).toContain(inline);
    expect(saved.loadComponentReviewMetadata(db, sessionId, 'Example')?.sourceCandidates).toEqual(raw.sourceCandidates);
    const projected = projectAcceptedRawSlots(raw, [
      {
        name: raw.name,
        source: raw.source,
        slot: 'heading',
        state: 'open',
        allowedComponents: [],
        coverage: 1,
        realVotes: 1,
        evidence: [],
      },
    ]);
    expect(projected.slots).toEqual([{ name: 'heading', isDefault: false, allowedComponents: [] }]);
    expect(projected.sourceCandidates).toEqual(raw.sourceCandidates);
  } finally {
    db.close();
  }
});

for (const [owner, extract] of producers)
  it(`${owner} preserves declaration-backed generic factory props and slot contracts`, async () => {
    const root = fixture({
      'helper.ts': `import {defineComponent} from 'vue';export function genericComponent<T>(){return defineComponent;}`,
      'Example.tsx': `import {genericComponent} from './helper.js';export const Example=genericComponent<{heading(value:string):unknown}>()({props:{label:String}});`,
    });
    const result = await extract({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
    const c = result.components.find((c) => c.framework === 'vue')!;
    expect(c.props.map((p) => p.name)).toEqual(['label']);
    expect(c.sourceCandidates?.find((c) => c.name === 'label')?.facts?.certainty).toBe('certain');
    expect(c.sourceCandidates?.find((c) => c.name === 'heading')?.observations[0]?.syntax).toMatchObject({
      reader: 'vue',
      channel: 'slot-contract',
    });
  });
