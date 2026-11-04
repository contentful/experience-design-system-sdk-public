import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents } from '../../../src/steps/extraction/index.js';
import { captureSourceEvidence } from '../../../src/steps/extraction/index.js';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  completeExtractionWithSourceEvidence,
  loadRawComponents,
} from '../../../src/persistence/src/session/repositories/db.js';
import { buildCompilerEvidenceInline } from '../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';
import { buildGenerationPrompt } from '../../../src/steps/generation/src/services/property/build-generation-prompt.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

async function extract() {
  const root = mkdtempSync(join(tmpdir(), 'closure-context-'));
  directories.push(root);
  const path = join(root, 'Surface.tsx');
  writeFileSync(
    path,
    'function readThing(value: string) { return value; } export function Surface(props: { label: string }) { return <section>{readThing(props.label)}</section>; }',
  );
  const component = (await extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
  const facts = component.componentFacts!;
  const helper = facts.sourceClosure!.nodes.find((node) => node.location.startOffset === 0)!;
  expect(helper).toBeDefined();
  facts.members = [{ name: 'Anything', certainty: 'certain', location: helper.location }];
  facts.childFilters = [
    { slot: 'arbitrary', kind: 'type-check', allowed: ['Anything'], certainty: 'ambiguous', location: helper.location },
  ];
  facts.requiresParent = [
    { parent: 'ArbitraryOwner', reason: 'context-missing', certainty: 'unknown', location: helper.location },
  ];
  facts.referencedOrigins = [
    {
      name: 'Anything',
      certainty: 'certain',
      location: helper.location,
      origin: { kind: 'in-repository', certainty: 'certain', location: helper.location },
    },
  ];
  const channel = () =>
    JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' })).componentFacts[0];
  return { root, path, component, facts, helper, channel };
}

it('keeps advisory proof boundaries visible in compact generation and complete evidence accessible', async () => {
  const { component, channel } = await extract();
  const original = JSON.stringify(component);
  const inline = buildCompilerEvidenceInline([component], { readiness: 'caller-provided' });
  const prompt = await buildGenerationPrompt(
    {
      skill: 'components',
      mode: 'autonomous',
      outDir: '/tmp/out',
      rawComponentsInline: JSON.stringify([component]),
      compilerEvidenceInline: inline,
    },
    component,
  );
  expect(prompt.originalPrompt).toContain('"claims":"conditional-advisory"');
  expect(prompt.originalPrompt).toContain('"schemaChanges":"not-authorized"');
  expect(prompt.originalPrompt).toContain('"mode":"retention-only"');
  expect(prompt.originalPrompt).toContain('"runtimeApplicability":"unestablished"');
  expect(prompt.fullContextPrompt).toContain(JSON.stringify(channel().closureFactProjection));
  expect(prompt.fullContextPrompt).toContain(JSON.stringify(channel().fieldProjectionPreview));
  expect(JSON.stringify(component)).toBe(original);
});

it('withholds compact derived claims when compiler evidence cannot be admitted', async () => {
  const { component } = await extract();
  const prompt = await buildGenerationPrompt(
    { skill: 'components', mode: 'autonomous', outDir: '/tmp/out', compilerEvidenceInline: 'invalid' },
    component,
  );
  expect(prompt.originalPrompt).not.toContain('"fieldSemanticsPolicy"');
  expect(prompt.originalPrompt).not.toContain('"fieldProjectionPreview"');
  expect(prompt.originalPrompt).not.toContain('"closureFactProjection"');
});

it('carries source context and supplied member/filter/parent/origin references through reachable summaries', async () => {
  const { component, facts, helper, channel } = await extract();
  const before = JSON.stringify(component);
  const projection = channel().closureFactProjection;
  expect(projection).toMatchObject({
    mode: 'lexical-advisory',
    runtimeApplicability: 'unestablished',
    rootId: facts.sourceClosure!.rootId,
  });
  const root = projection.summaries.find((item: { nodeId: string }) => item.nodeId === projection.rootId);
  expect(root.componentFacts.map((item: { channel: string }) => item.channel)).toEqual([
    'members',
    'childFilters',
    'requiresParent',
    'referencedOrigins',
  ]);
  expect(root.componentFacts.find((item: { channel: string }) => item.channel === 'requiresParent')).toMatchObject({
    ownerId: helper.id,
    strength: 'unknown',
  });
  const inherited = root.observations.find((item: { ownerId: string }) => item.ownerId === helper.id);
  expect(inherited.context.execution).toBe('referenced-body');
  expect(inherited.provenance).toContain(projection.rootId);
  expect(root.observations.some((item: { referencedSymbols: unknown[] }) => item.referencedSymbols.length > 0)).toBe(
    true,
  );
  expect(JSON.stringify(component)).toBe(before);
});

it('keeps missing and changed component-fact locations unassigned without changing source facts', async () => {
  const { facts, channel } = await extract();
  facts.members![0]!.location = null;
  facts.requiresParent![0]!.location = {
    ...facts.requiresParent![0]!.location!,
    textHash: 'changed',
    binding: 'changed',
  };
  const projection = channel().closureFactProjection;
  expect(projection.unassignedComponentFacts).toEqual(
    expect.arrayContaining([
      { channel: 'members', index: 0, reason: 'component-fact-location-unavailable' },
      { channel: 'requiresParent', index: 0, reason: 'component-fact-source-changed' },
    ]),
  );
  expect(facts.members).toHaveLength(1);
  expect(facts.requiresParent).toHaveLength(1);
});

it('withholds closure projections with unavailable readiness or corrupt summary membership', async () => {
  const { component, facts } = await extract();
  expect(
    JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'unavailable' })).componentFacts[0]
      .closureFactProjection,
  ).toBeUndefined();
  facts.sourceClosure!.summaries[0]!.facts[0]!.observationId = 'fabricated';
  const evidence = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }))
    .componentFacts[0];
  expect(evidence.status).toBe('corrupt');
  expect(evidence.closureFactProjection).toBeUndefined();
});

it('bounds derived records while retaining the full source channel', async () => {
  const { facts, channel } = await extract();
  delete facts.sourceObservations!.fieldSemantics;
  facts.sourceObservations!.limits.maxObservations = facts.sourceObservations!.observations.length;
  const entry = channel();
  expect(entry.status).toBe('available');
  const projection = entry.closureFactProjection;
  expect(projection.limits.maxRecords).toBe(facts.sourceObservations!.limits.maxObservations);
  expect(projection.usedRecords).toBeLessThanOrEqual(projection.limits.maxRecords);
  expect(projection.omittedRecords).toBeGreaterThan(0);
  expect(entry.facts.requiresParent).toEqual(facts.requiresParent);
});

it('rebuilds joined closure evidence from saved current-session facts after live source changes', async () => {
  const { root, path, component } = await extract();
  const dbPath = join(root, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', {}),
    components: [component],
    cycles: [],
    scannedFiles: ['Surface.tsx'],
    capture: await captureSourceEvidence({ projectRoot: root, filePaths: [path] }),
    observations: { accepted: [], rejected: [] },
  });
  db.close();
  writeFileSync(path, 'changed live source');
  const reopened = openPipelineDb(dbPath);
  try {
    const saved = loadRawComponents(reopened, sessionId)[0]!;
    const entry = JSON.parse(buildCompilerEvidenceInline([saved], { readiness: 'ready' })).componentFacts[0];
    expect(entry.status).toBe('available');
    expect(entry.closureFactProjection.sourceBinding).toBe('verified');
    const rootSummary = entry.closureFactProjection.summaries.find(
      (item: { nodeId: string }) => item.nodeId === entry.closureFactProjection.rootId,
    );
    expect(rootSummary.componentFacts).toHaveLength(4);
    expect(
      rootSummary.componentFacts.find((item: { channel: string }) => item.channel === 'requiresParent').strength,
    ).toBe('unknown');
    expect(saved.componentFacts!.requiresParent).toHaveLength(1);
    expect(saved.props.map((prop) => prop.name)).toContain('label');
  } finally {
    reopened.close();
  }
});

it('preserves incoming call conditions without treating a referenced body as executed', async () => {
  const { path, root } = await extract();
  writeFileSync(
    path,
    'function readThing(value: string) { return value; } export function Surface(props: { label: string; gate: boolean }) { if (props.gate) return readThing(props.label); return "quiet"; }',
  );
  const component = (await extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
  const projection = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }))
    .componentFacts[0].closureFactProjection;
  const summary = projection.summaries.find((item: { nodeId: string }) => item.nodeId === projection.rootId);
  const call = summary.observations.find(
    (item: { kind: string; context: { execution: string } }) =>
      item.kind === 'call' && item.context.execution === 'component-body',
  );
  expect(call.context.conditions).toEqual(
    expect.arrayContaining([expect.objectContaining({ expression: 'props.gate', branch: 'then' })]),
  );
  expect(
    summary.observations.some(
      (item: { context: { execution: string } }) => item.context.execution === 'referenced-body',
    ),
  ).toBe(true);
  expect(projection.runtimeApplicability).toBe('unestablished');
});

it('keeps supplied certainty separate from inherited reachability strength and field names', async () => {
  const { facts, helper, channel } = await extract();
  facts.members![0]!.name = '__proto__';
  facts.childFilters![0]!.slot = 'arbitrary callback';
  const projection = channel().closureFactProjection;
  const own = projection.summaries.find((item: { nodeId: string }) => item.nodeId === helper.id);
  const inherited = projection.summaries.find((item: { nodeId: string }) => item.nodeId === projection.rootId);
  expect(own.componentFacts.find((item: { channel: string }) => item.channel === 'members').strength).toBe('exact');
  expect(inherited.componentFacts.find((item: { channel: string }) => item.channel === 'members').strength).toBe(
    'inferred',
  );
  expect(inherited.componentFacts.find((item: { channel: string }) => item.channel === 'requiresParent').strength).toBe(
    'unknown',
  );
  expect(facts.members![0]!.name).toBe('__proto__');
});

it.each(['changed', 'unavailable'] as const)(
  'withholds current joined claims when the closure source is %s',
  async (binding) => {
    const { facts, channel } = await extract();
    facts.sourceClosure!.binding = binding;
    const projection = channel().closureFactProjection;
    expect(projection.status).toBe('unavailable');
    expect(projection.summaries).toEqual([]);
    expect(projection.unassignedComponentFacts).toHaveLength(4);
    expect(facts.requiresParent).toHaveLength(1);
  },
);

it('retains facts whose location is outside the observed graph', async () => {
  const { facts, channel } = await extract();
  facts.members![0]!.location = { ...facts.members![0]!.location!, canonicalPath: '/example/unobserved.ts' };
  expect(channel().closureFactProjection.unassignedComponentFacts).toContainEqual({
    channel: 'members',
    index: 0,
    reason: 'component-fact-owner-unobserved',
  });
  expect(facts.members).toHaveLength(1);
});

it('retains unknown/open closure witnesses without promoting supplied facts', async () => {
  const { facts, helper, channel } = await extract();
  const root = facts.sourceClosure!.summaries.find((summary) => summary.nodeId === facts.sourceClosure!.rootId)!;
  const witness = root.facts.find((fact) => fact.ownerId === helper.id && fact.kind === 'declaration')!;
  witness.strength = 'unknown';
  witness.dependsOnOpenEnd = true;
  const summary = channel().closureFactProjection.summaries.find(
    (item: { nodeId: string }) => item.nodeId === facts.sourceClosure!.rootId,
  );
  expect(summary.componentFacts.find((item: { channel: string }) => item.channel === 'members')).toMatchObject({
    strength: 'unknown',
    dependsOnOpenEnd: true,
  });
  expect(facts.members![0]!.certainty).toBe('certain');
});

it('keeps derived contexts and provenance independent from the delivered raw facts', async () => {
  const { channel } = await extract();
  const entry = channel();
  const before = JSON.stringify(entry.facts);
  const observation = entry.closureFactProjection.summaries[0].observations[0];
  observation.context.execution = 'source-file';
  observation.provenance.push('changed-preview-only');
  expect(JSON.stringify(entry.facts)).toBe(before);
});

it('does not attach facts from an uncalled nested body to a reachable enclosing declaration', async () => {
  const { path, root } = await extract();
  writeFileSync(
    path,
    'function readThing(value: string) { return value; } export function Surface(props: { label: string }) { const latent = () => props.label; return <section>{readThing(props.label)}</section>; }',
  );
  const component = (await extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
  const facts = component.componentFacts!;
  const nested = facts.sourceObservations!.observations.find(
    (observation) => observation.context.execution === 'deferred',
  )!.context.lexicalDeclaration!;
  facts.requiresParent = [
    { parent: 'ArbitraryOwner', reason: 'context-missing', certainty: 'certain', location: nested },
  ];
  const projection = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }))
    .componentFacts[0].closureFactProjection;
  expect(projection.summaries.flatMap((summary: { componentFacts: unknown[] }) => summary.componentFacts)).toHaveLength(
    0,
  );
  expect(projection.unassignedComponentFacts).toContainEqual({
    channel: 'requiresParent',
    index: 0,
    reason: 'component-fact-owner-unobserved',
  });
  expect(facts.requiresParent).toHaveLength(1);
});

it('carries every supplied component-fact channel without copying its semantic payload', async () => {
  const { facts, helper, channel } = await extract();
  facts.renderables = [{ name: 'layout', delivery: 'node-prop', certainty: 'certain', location: helper.location }];
  facts.nonStatic = [{ kind: 'context-read', certainty: 'ambiguous', location: helper.location }];
  facts.origin = { kind: 'in-repository', certainty: 'certain', location: helper.location };
  const projection = channel().closureFactProjection;
  const summary = projection.summaries.find((item: { nodeId: string }) => item.nodeId === projection.rootId);
  expect(summary.componentFacts.map((item: { channel: string }) => item.channel)).toEqual([
    'renderables',
    'members',
    'childFilters',
    'requiresParent',
    'nonStatic',
    'origin',
    'referencedOrigins',
  ]);
  expect(summary.componentFacts.every((item: { index: number }) => item.index === 0)).toBe(true);
  expect(
    summary.componentFacts.every((item: Record<string, unknown>) => !('parent' in item) && !('allowed' in item)),
  ).toBe(true);
});
