import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents } from '../../../../../src/steps/extraction/index.js';
import { readComponentFacts } from '../../../../../src/persistence/src/session/repositories/component-facts-validation.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
async function extract(
  body: string,
  declarations = '',
  maxNodes = 1000,
  fieldName = 'alpha',
  files: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'field-semantics-'));
  directories.push(root);
  const file = join(root, 'Surface.tsx');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  writeFileSync(
    file,
    `${declarations}
    export function Surface(props: { data: { ${JSON.stringify(fieldName)}: string; beta: string }; gate: boolean; opaque: any }) { ${body} }`,
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
      proof.inputName === 'data' && JSON.stringify(proof.path) === JSON.stringify([{ kind: 'field', key: fieldName }]),
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

it('tracks mapping callback replacement without interpreting component patterns', async () => {
  const { alpha, evidence } = await extract(
    'return [props.data].map(value => { const next = { ...value, alpha: "fixed" }; return next.alpha; })[0];',
  );
  expect(evidence.coverage).toBe('complete-within-declared-bound');
  expect(alpha.valueIndependence.status).toBe('conditional');
  expect(alpha.valueIndependence.premises).toContain('standard-local-array-map');
});

it('keeps captured record writes during mapping open', async () => {
  const { alpha, evidence } = await extract(
    'const next = { alpha: props.data.alpha }; ["fixed"].map(value => { next.alpha = value; return value; }); return next.alpha;',
  );
  expect(evidence.coverage).toBe('partial');
  expect(alpha.valueIndependence.status).toBe('unknown');
});

it('preserves locally resolved record callables whose member happens to be named map', async () => {
  const { alpha, evidence } = await extract(
    'const helper = { map: (value: string) => "fixed" }; return helper.map(props.data.alpha);',
  );
  expect(evidence.coverage).toBe('complete-within-declared-bound');
  expect(alpha.valueIndependence.status).toBe('conditional');
});

it('keeps imported reassigned callable targets open', async () => {
  const { alpha, evidence } = await extract(
    'return helper(props.data.alpha);',
    'import { helper } from "./helper.js";',
    1000,
    'alpha',
    {
      'helper.ts':
        'export function helper(value: string) { return "fixed"; } helper = replacement; declare function replacement(value: string): string;',
    },
  );
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(evidence.omissions.some((entry) => entry.reason === 'external-binding-written')).toBe(true);
});

it('retains initialized local aliases and implicit helper return provenance', async () => {
  const { alpha, evidence } = await extract(
    'const helper = (value: { alpha: string; beta: string }) => ({ ...value, alpha: "fixed" }); const alias = helper; return alias(props.data).alpha;',
  );
  expect(alpha.valueIndependence.status).toBe('conditional');
  expect(evidence.steps.some((entry) => entry.operation === 'return' && entry.frame > 0)).toBe(true);
});

it.each([
  'const next = { ...props.data }; props.gate && (next.alpha = "fixed"); return next.alpha;',
  'const next = { ...props.data }; props.gate || (next.alpha = "fixed"); return next.alpha;',
  'const next = { ...props.data }; props.opaque ?? (next.alpha = "fixed"); return next.alpha;',
])('keeps conditional assignment execution open: %s', async (body) => {
  const { alpha } = await extract(body);
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(alpha.omissionSafety.status).toBe('unknown');
});

it('keeps prototype-sensitive assignment omission open', async () => {
  const { alpha } = await extract(
    'const next = { ...props.data }; next["__proto__"] = "fixed"; return next["__proto__"];',
    '',
    1000,
    '__proto__',
  );
  expect(alpha.omissionSafety.status).toBe('unknown');
});

it.each([
  [
    'const next = { ...props.data, alpha: "fixed" }; change(next, props.data.alpha, props.gate); return next.alpha;',
    'function change(value: { alpha: string }, input: string, gate: boolean) { if (gate) value.alpha = input; }',
  ],
  [
    'const next = { ...props.data, alpha: "fixed" }; const alias = identity(next); alias.alpha = props.data.alpha; return next.alpha;',
    'function identity(value: { alpha: string; beta: string }) { return value; }',
  ],
  [
    'const next = { ...props.data, alpha: "fixed" }; const alias = props.gate ? next : next; alias.alpha = props.data.alpha; return next.alpha;',
    '',
  ],
  [
    'const next = { ...props.data, alpha: "fixed" }; props.gate ? (next.alpha = props.data.alpha) : "fixed"; return next.alpha;',
    '',
  ],
])('keeps cross-frame record mutations and returned aliases open: %s', async (body, declarations) => {
  const { alpha } = await extract(body, declarations);
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(alpha.omissionSafety.status).toBe('unknown');
});

it('retains private record writes within a resolved helper frame', async () => {
  const { alpha } = await extract(
    'return helper(props.data).alpha;',
    'function helper(value: { alpha: string; beta: string }) { const next = { ...value }; next.alpha = "fixed"; return next; }',
  );
  expect(alpha.valueIndependence.status).toBe('conditional');
});

it.each([
  [
    'let result = "fixed"; function change(value: string) { result = value; } change(props.data.alpha); return result;',
    '',
  ],
  ['shared = props.data.alpha; return "fixed";', 'let shared = "fixed";'],
])('keeps captured and external binding effects open: %s', async (body, declarations) => {
  const { alpha, evidence } = await extract(body, declarations);
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(evidence.coverage).toBe('partial');
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

it.each([
  "const next = props.data.alpha ? { alpha: 'first' } : { alpha: 'second' }; return next.alpha;",
  'const next = props.gate && { value: props.data.alpha }; return next.value;',
  "return 'alpha' in props.data;",
])('preserves controlling and ambiguous object alternatives: %s', async (body) => {
  const { alpha } = await extract(body);
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(alpha.omissionSafety.status).toBe('unknown');
});

it('rejects a conditional certificate whose root source identity was altered', async () => {
  const { component } = await extract("const next = { ...props.data, alpha: 'fixed' }; return next.alpha;");
  const facts = structuredClone(component.componentFacts!);
  facts.sourceObservations!.fieldSemantics!.source.textHash = 'a'.repeat(64);
  expect(readComponentFacts(facts).status).toBe('corrupt');
});

it.each([6, 999])(
  'reports unsupported semantic versions instead of treating them as current facts: %s',
  async (version) => {
    const { component } = await extract("const next = { ...props.data, alpha: 'fixed' }; return next.alpha;");
    const facts = JSON.parse(JSON.stringify(component.componentFacts));
    facts.sourceObservations.fieldSemantics.schemaVersion = version;
    expect(readComponentFacts(facts).status).toBe('unsupported');
  },
);

it('never admits promoted or premise-free omission claims', async () => {
  const { component } = await extract("const next = { ...props.data, alpha: 'fixed' }; return next.alpha;");
  for (const promoted of [true, false]) {
    const facts = JSON.parse(JSON.stringify(component.componentFacts));
    const proof = facts.sourceObservations.fieldSemantics.proofs.find(
      (entry: { inputName: string; path: unknown[] }) => entry.inputName === 'data' && entry.path.length > 0,
    );
    if (promoted) proof.omissionSafety.status = 'proven';
    else proof.omissionSafety.premises = [];
    expect(readComponentFacts(facts).status).toBe('corrupt');
  }
});

it('states unresolved alias and intrinsic applicability as conditional premises', async () => {
  const { alpha } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  expect(alpha.valueIndependence.premises).toContain('isolated-input-tree');
  expect(alpha.valueIndependence.premises).toContain('standard-record-intrinsics');
  expect(alpha.omissionSafety.premises).toEqual(expect.arrayContaining(alpha.valueIndependence.premises));
});

it('does not reinterpret the older premise contract as current evidence', async () => {
  const { component } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  const facts = JSON.parse(JSON.stringify(component.componentFacts));
  facts.sourceObservations.fieldSemantics.schemaVersion = 1;
  expect(readComponentFacts(facts).status).toBe('unsupported');
});

it.each([
  'const next = { ...props.data, alpha: "fixed" }; return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; return next;',
  'props.opaque(props.data); return "fixed";',
])('retains coherent conditional and unknown evidence on reload: %s', async (body) => {
  const { component } = await extract(body);
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
});

it.each([
  'possible-dependence',
  'open-obligation',
  'partial-coverage',
  'value-reason',
  'omission-reason',
  'missing-alias-premise',
])('rejects inconsistent conditional evidence: %s', async (fault) => {
  const { component } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  const facts = structuredClone(component.componentFacts!);
  const semantics = facts.sourceObservations!.fieldSemantics!;
  const proof = semantics.proofs.find((entry) => entry.inputName === 'data' && entry.path.length === 1)!;
  if (fault === 'possible-dependence') proof.outputDependence = 'possible';
  if (fault === 'open-obligation') {
    semantics.coverage = 'partial';
    semantics.omissions.push({ reason: 'opaque-call-effects-open', location: semantics.source });
  }
  if (fault === 'partial-coverage') semantics.coverage = 'partial';
  if (fault === 'value-reason') proof.valueIndependence.reasons = ['possible-output-dependence'];
  if (fault === 'omission-reason') proof.omissionSafety.reasons = ['presence-or-order-observable'];
  if (fault === 'missing-alias-premise') {
    proof.valueIndependence.premises = ['ordinary-own-data-inputs'];
    proof.omissionSafety.premises = ['ordinary-own-data-inputs', 'entry-delivery-admits-omission'];
  }
  expect(readComponentFacts(facts).status).toBe('corrupt');
});

it.each(['return () => props.data.alpha;', 'return { invoke: () => props.data.alpha };'])(
  'keeps escaped callback observability open: %s',
  async (body) => {
    const { alpha, evidence } = await extract(body);
    expect(alpha.valueIndependence.status).toBe('unknown');
    expect(alpha.omissionSafety.status).toBe('unknown');
    expect(evidence.omissions.some((entry) => entry.reason === 'callable-escape-open')).toBe(true);
  },
);

it.each(['plain', '_value', 'className', 'a.b', '__proto__', ''])(
  'preserves equivalent field semantics and exact path spelling for %j',
  async (name) => {
    const key = JSON.stringify(name);
    const { alpha, component } = await extract(
      `const next = { ...props.data, [${key}]: 'fixed' }; return next[${key}];`,
      '',
      1000,
      name,
    );
    expect(alpha.path).toEqual([{ kind: 'field', key: name }]);
    expect(alpha.valueIndependence.status).toBe('conditional');
    expect(alpha.omissionSafety.status).toBe('conditional');
    expect(
      component.sourceCandidates
        ?.find((candidate) => candidate.name === 'data')
        ?.facts?.sourceGraph?.nodes.flatMap((node) => node.fields ?? [])
        .some((field) => field.key === name),
    ).toBe(true);
  },
);

it.each([
  ['shared.alpha = props.data.alpha; return "fixed";', 'const shared: { alpha?: string } = {};'],
  [
    'return helper(props.data.alpha);',
    'function helper(value: string) { return "fixed"; } helper = replacement; declare function replacement(value: string): string;',
  ],
  ['const next = helper(props.data); const helper = (value: unknown) => "fixed"; return next;', ''],
])('keeps shared state, reassigned targets and unexecuted bindings open: %s', async (body, declarations) => {
  const { alpha, evidence } = await extract(body, declarations);
  expect(alpha.valueIndependence.status).toBe('unknown');
  expect(alpha.omissionSafety.status).toBe('unknown');
  expect(evidence.coverage).toBe('partial');
});
