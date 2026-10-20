import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ts } from 'ts-morph';
import { extractWebComponentDefinitions } from '../../../src/extract/framework-adapters/web-components/extractor.js';
import { createWebComponentCompilerContexts } from '../../../src/extract/framework-adapters/web-components/helpers/read-wc-syntax.js';
import { readdirSync } from 'node:fs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
function fixture(files: Record<string, string>) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'wc-completion-')));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  return { directory, file: join(directory, 'Element.ts') };
}

it('preserves the supplied component path while evidence locations identify canonical bytes', async () => {
  const { directory, file } = fixture({
    'Element.ts':
      "class ExampleElement extends HTMLElement { label: string = ''; } customElements.define('example-element', ExampleElement);",
  });
  const aliases = fixture({}).directory;
  const alias = join(aliases, 'project');
  symlinkSync(directory, alias, 'dir');
  const supplied = join(alias, 'Element.ts');
  const result = await extractWebComponentDefinitions([supplied], undefined, { projectRoot: alias });
  expect(result.components[0]).toMatchObject({ source: supplied, sourcePath: supplied });
  expect(
    result.components[0]?.sourceCandidates?.find((candidate) => candidate.name === 'label')?.facts?.declarations[0]
      ?.canonicalPath,
  ).toBe(realpathSync.native(file));
});

it('resolves nested supplied-base lexical bindings and function-returned classes without erasing lineage', async () => {
  const { file, directory } = fixture({
    'Base.ts': `export class Base extends HTMLElement { inherited: number = 1; shared: number = 0; }`,
    'Mixins.ts': `export function Inner(Base: any) { return class InnerClass extends Base { inner = false; shared = false; }; }
      export const Outer = (Base: any) => class OuterClass extends Inner(Base) { outer = ''; };`,
    'Element.ts': `import { Base } from './Base'; import { Outer } from './Mixins';
      class ExampleElement extends Outer(Base) { shared: string = 'own'; } customElements.define('example-element', ExampleElement);`,
  });
  const result = await extractWebComponentDefinitions([file]);
  const component = result.components[0]!;
  expect(component.props.map((prop) => prop.name)).toEqual(['inherited', 'inner', 'outer', 'shared']);
  expect(component.props.find((prop) => prop.name === 'shared')).toMatchObject({ type: 'string', defaultValue: 'own' });
  const inherited = component.sourceCandidates!.find((candidate) => candidate.name === 'inherited')!;
  expect(inherited.observations[0]).toMatchObject({
    origin: 'imported',
    location: { canonicalPath: join(directory, 'Base.ts'), startLine: 1 },
  });
  expect(inherited.observations[0]!.syntax).toMatchObject({ lineage: 'base', declaringClass: 'Base' });
  const shared = component.sourceCandidates!.find((candidate) => candidate.name === 'shared')!;
  expect(shared.observations.filter((observation) => observation.evidenceKind === 'declaration')).toHaveLength(3);
  expect(new Set(shared.observations.map((observation) => observation.location?.canonicalPath))).toEqual(
    new Set([file, join(directory, 'Mixins.ts'), join(directory, 'Base.ts')]),
  );
  expect(shared.facts!.certainty).toBe('ambiguous');
  expect(
    result.extractionDiagnostics!.modules.filter(
      (diagnostic) => diagnostic.reason?.startsWith('wc-') && !diagnostic.fromPath.endsWith('lib.dom.d.ts'),
    ),
  ).toEqual([]);
});

it('retains the base under repeated finite mixin applications and keeps supplied scope separate', async () => {
  const { file } = fixture({
    'Element.ts': `class Base extends HTMLElement { inherited = 1; }
      const Inner = (Base: any) => class extends Base { inner = ''; };
      function Outer(Base: any) { return class extends Inner(Base) { outer = false; }; }
      class ExampleElement extends Outer(Outer(Base)) { own = ''; }
      customElements.define('example-element', ExampleElement);`,
  });
  const result = await extractWebComponentDefinitions([file]);
  expect(result.components[0]!.props.map((prop) => prop.name)).toEqual(['inherited', 'inner', 'outer', 'own']);
  expect(
    result.extractionDiagnostics!.modules.filter(
      (diagnostic) => diagnostic.reason?.startsWith('wc-') && !diagnostic.fromPath.endsWith('lib.dom.d.ts'),
    ),
  ).toEqual([]);
});

it.each([
  ['missing import', `import { Missing } from './missing';`, 'Missing', 'wc-unresolved-base'],
  ['computed call', '', 'unknownMixins["factory"](HTMLElement)', 'wc-unresolved-mixin'],
  ['property-access call', '', 'unknownMixins.factory(HTMLElement)', 'wc-unresolved-mixin'],
  ['unknown call', '', 'unknownMixin(HTMLElement)', 'wc-unresolved-mixin'],
  ['class cycle', 'class Base extends ExampleElement { discovered = 0; }', 'Base', 'wc-inheritance-cycle'],
])('keeps discovered declarations and explicit uncertainty for %s', async (_label, prefix, base, reason) => {
  const { file } = fixture({
    'Element.ts': `${prefix} class ExampleElement extends ${base} { own = false; } customElements.define('example-element', ExampleElement);`,
  });
  const result = await extractWebComponentDefinitions([file]);
  expect(result.components[0]!.props.some((prop) => prop.name === 'own')).toBe(true);
  expect(
    result.components[0]!.sourceCandidates!.find((candidate) => candidate.name === 'own')!.facts!.declarations,
  ).not.toEqual([]);
  expect(result.extractionDiagnostics!.modules).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason, outcome: 'unavailable' })]),
  );
  if (reason === 'wc-inheritance-cycle')
    expect(result.components[0]!.props.some((prop) => prop.name === 'discovered')).toBe(true);
});

it.each([31, 32])('enforces the declared depth bound at %i base transitions', async (transitions) => {
  const classes = Array.from(
    { length: transitions },
    (_, i) => `class Base${i} ${i ? `extends Base${i - 1}` : ''} { field${i}=0; }`,
  ).join('\n');
  const { file } = fixture({
    'Element.ts': `${classes}\nclass ExampleElement extends Base${transitions - 1} {own=false;} customElements.define('example-element', ExampleElement);`,
  });
  const result = await extractWebComponentDefinitions([file]);
  expect(result.extractionDiagnostics!.limits.maxWcClassDepth).toBe(64);
  expect(result.components[0]!.props).toHaveLength(32);
  expect(
    result.extractionDiagnostics!.modules.some((diagnostic) => diagnostic.reason === 'wc-inheritance-depth-exhausted'),
  ).toBe(transitions === 32);
});

it.each([2048, 2049])('enforces the declared observation bound at %i declarations', async (count) => {
  const fields = Array.from({ length: count }, (_, i) => `field${i}=0;`).join('\n');
  const { file } = fixture({
    'Element.ts': `class ExampleElement {${fields}} customElements.define('example-element', ExampleElement);`,
  });
  const result = await extractWebComponentDefinitions([file]);
  expect(result.extractionDiagnostics!.limits.maxWcDeclarations).toBe(2048);
  expect(result.components[0]!.props).toHaveLength(2048);
  expect(result.extractionDiagnostics!.used.wcDeclarations).toBe(count);
  expect(
    result.extractionDiagnostics!.modules.some((diagnostic) => diagnostic.reason === 'wc-declaration-budget-exhausted'),
  ).toBe(count === 2049);
  expect(result.components[0]!.sourceCandidates).toHaveLength(2048);
});

it('uses configured noEmit while support and declaration files stay evidence without emitted components', async () => {
  const { file, directory } = fixture({
    'tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: false, noEmit: false, target: 'ES2020', outDir: 'emitted' },
      include: ['*.ts', '*.js'],
    }),
    'Support.ts': `export class Support extends HTMLElement {inherited=0;} customElements.define('support-only',Support);`,
    'Declaration.d.ts': `export declare class Declaration extends HTMLElement {fromDeclaration:string;}`,
    'Element.ts': `import {Support} from './Support';import type {Declaration} from './Declaration';class ExampleElement extends Support { label?:Declaration;} customElements.define('example-element', ExampleElement);`,
  });
  const contexts = createWebComponentCompilerContexts([file, join(directory, 'Declaration.d.ts')], {
    projectRoot: directory,
  });
  expect(contexts.contexts[0]!.project.compilerOptions.get().noEmit).toBe(true);
  expect(contexts.contexts[0]!.project.compilerOptions.get().allowJs).toBe(true);
  expect(contexts.contexts[0]!.componentFiles).toEqual([file]);
  expect(contexts.contexts[0]!.project.getSourceFile(join(directory, 'Support.ts'))).toBeTruthy();
  expect(contexts.contexts[0]!.project.getSourceFile(join(directory, 'Declaration.d.ts'))).toBeTruthy();
  const before = readdirSync(directory).sort();
  const result = await extractWebComponentDefinitions([file, join(directory, 'Declaration.d.ts')], undefined, {
    projectRoot: directory,
  });
  expect(result.components).toHaveLength(1);
  expect(result.components[0]!.source).toBe(file);
  expect(
    result.components[0]!.sourceCandidates!.find((candidate) => candidate.name === 'inherited')!.facts!.declarations[0]!
      .canonicalPath,
  ).toBe(join(directory, 'Support.ts'));
  expect(result.extractionDiagnostics!.projects[0]!.options).toMatchObject({
    noEmit: true,
    allowJs: true,
    target: ts.ScriptTarget.ES2020,
  });
  expect(readdirSync(directory).sort()).toEqual(before);
});

it('retains zero-component configured diagnostics without output artifacts', async () => {
  const { file, directory } = fixture({
    'tsconfig.json': '{"compilerOptions": { "target": "invalid" }}',
    'Element.ts': 'export const support=0;',
  });
  const before = readdirSync(directory).sort();
  const result = await extractWebComponentDefinitions([file], undefined, { projectRoot: directory });
  expect(result.components).toEqual([]);
  expect(result.extractionDiagnostics!.projects[0]!.status).toBe('invalid');
  expect(result.extractionDiagnostics!.projects[0]!.diagnostics.length).toBeGreaterThan(0);
  expect(readdirSync(directory).sort()).toEqual(before);
});
