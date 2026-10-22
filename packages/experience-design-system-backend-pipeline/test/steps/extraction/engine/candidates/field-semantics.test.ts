import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents } from '../../../../../src/steps/extraction/index.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
async function extract(body: string, declarations = '', maxNodes = 1000) {
  const root = mkdtempSync(join(tmpdir(), 'field-semantics-'));
  directories.push(root);
  const file = join(root, 'Surface.tsx');
  writeFileSync(
    file,
    `${declarations}
    export function Surface(props: { data: { alpha: string; beta: string }; gate: boolean; opaque: any }) { ${body} }`,
  );
  const component = (
    await extractReactComponents([file], undefined, {
      projectRoot: root,
      componentObservationLimits: { maxNodes },
    })
  ).components.find((entry) => entry.name === 'Surface')!;
  const evidence = component.componentFacts!.sourceObservations!.fieldSemantics;
  expect(evidence).toBeDefined();
  const alpha = evidence!.proofs.find(
    (proof) =>
      proof.inputName === 'data' && JSON.stringify(proof.path) === JSON.stringify([{ kind: 'field', key: 'alpha' }]),
  )!;
  expect(alpha).toBeDefined();
  expect(component.sourceCandidates?.find((candidate) => candidate.name === 'data')?.facts?.sourceGraph).toBeDefined();
  return { component, evidence: evidence!, alpha };
}

it.each([
  "const next = { ...props.data, alpha: 'fixed' }; return next.alpha;",
  "const next = { ...props.data }; const alias = next; alias.alpha = 'fixed'; return next.alpha;",
  "const next = props.gate ? { ...props.data, alpha: 'first' } : { ...props.data, alpha: 'second' }; return next.alpha;",
])('records conditional independence for ordered replacement: %s', async (body) => {
  const { alpha, evidence } = await extract(body);
  expect(alpha.valueIndependence.status).toBe('conditional');
  expect(alpha.omissionSafety.status).toBe('conditional');
  expect(alpha.valueIndependence.premises).toContain('ordinary-own-data-inputs');
  expect(alpha.omissionSafety.premises).toContain('entry-delivery-admits-omission');
  expect(evidence.steps.some((step) => step.operation === 'write')).toBe(true);
});

it('separates value replacement from observable own-key order', async () => {
  const { alpha } = await extract("const next = { ...props.data, alpha: 'fixed' }; return next;");
  expect(alpha.valueIndependence.status).toBe('conditional');
  expect(alpha.omissionSafety.status).toBe('unknown');
  expect(alpha.omissionSafety.reasons).toContain('presence-or-order-observable');
});

it.each([
  "const before = props.data.alpha; const next = { ...props.data, alpha: 'fixed' }; return before;",
  "const next = { alpha: 'fixed', ...props.data }; return next.alpha;",
  "const next = { ...props.data, alpha: props.data.alpha ?? 'fixed' }; return next.alpha;",
])('retains dependence from an earlier read, later spread or dependent replacement: %s', async (body) => {
  const { alpha } = await extract(body);
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(alpha.outputDependence).toBe('possible');
});

it('substitutes compiler-resolved helper parameters without recognizing helper names', async () => {
  const { alpha, evidence } = await extract(
    'const next = arbitrary(props.data); return next.alpha;',
    "function arbitrary(value: { alpha: string; beta: string }) { return { ...value, alpha: 'fixed' }; }",
  );
  expect(alpha.valueIndependence.status).toBe('conditional');
  expect(evidence.steps.some((step) => step.operation === 'call' && step.frame > 0)).toBe(true);
});

it.each([
  "opaque(props.data); const next = { ...props.data, alpha: 'fixed' }; return next.alpha;",
  "const next = { ...props.data }; opaque(next); next.alpha = 'fixed'; return next.alpha;",
  "props.data.alpha = 'fixed'; return props.data.alpha;",
  "while (props.gate) {} return 'fixed';",
  "return <section {...props.data} alpha='fixed' />;",
])('keeps effects, input mutation, escapes and open execution unknown: %s', async (body) => {
  const { alpha, evidence } = await extract(body, 'declare function opaque(value: unknown): unknown;');
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(alpha.omissionSafety.status).toBe('unknown');
  expect(evidence.coverage).toBe('partial');
  expect(evidence.omissions.length).toBeGreaterThan(0);
});

it('binds exact source identities and remains bounded', async () => {
  const { evidence, alpha } = await extract(
    "const next = { ...props.data, alpha: 'fixed' }; return next.alpha;",
    '',
    35,
  );
  expect(evidence.used.nodes).toBeLessThanOrEqual(35);
  expect(evidence.componentDeclarationId).toBeDefined();
  expect(evidence.source.textHash).toMatch(/^[a-f0-9]{64}$/);
  expect(alpha.valueIndependence.status).not.toBe('proven');
  expect(alpha.omissionSafety.status).not.toBe('proven');
});
