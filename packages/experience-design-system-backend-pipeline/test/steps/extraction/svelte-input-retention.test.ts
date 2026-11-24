import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { parse } from 'svelte/compiler';
import { afterEach, expect, it } from 'vitest';
import { extractSvelteComponents } from '../../../src/steps/extraction/src/framework-adapters/svelte/extractor.js';
import { isSnippetTypeText } from '../../../src/steps/extraction/src/framework-adapters/svelte/helpers/render-svelte-type.js';
import { typeRefersToSnippet } from '../../../src/steps/extraction/src/framework-adapters/svelte/helpers/extract-svelte-declaration-data.js';
import { maybeRunResolveUnreachableRetry } from '../../../src/steps/extraction/src/framework-adapters/svelte/helpers/resolve-svelte-unresolved-retry.js';
import { findPropsCall } from '../../../src/steps/extraction/src/framework-adapters/svelte/helpers/find-svelte-script-declarations.js';
import { getRetryAnnotation } from '../../../src/steps/extraction/src/framework-adapters/svelte/helpers/extract-svelte-props.js';
import type { AstNode } from '../../../src/steps/extraction/src/framework-adapters/svelte/types/svelte-ast-node.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it.each(['Snippet', 'UnusualValue'])('retains inherited data named %s in a folder named svelte', async (name) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'input-retention-')));
  roots.push(root);
  const directory = join(root, 'svelte');
  mkdirSync(directory);
  const path = join(directory, 'Example.svelte');
  writeFileSync(
    path,
    `<script lang="ts">
    type ${name} = { value: string };
    interface Base { payload: ${name}; children?: ${name}; onPaint?: ${name} }
    interface Inputs extends Base { count: number }
    let { payload, children, onPaint, count }: Inputs = $props();
    </script><div>{payload.value}{count}</div>`,
  );
  const component = (await extractSvelteComponents([path])).components[0]!;
  expect(component.props.map((prop) => prop.name).sort()).toEqual(['children', 'count', 'onPaint', 'payload']);
  expect(component.props.find((prop) => prop.name === 'payload')?.type).toContain(name);
  expect(component.props.find((prop) => prop.name === 'payload')?.required).toBe(true);
  for (const key of ['children', 'onPaint']) {
    expect(component.props.find((prop) => prop.name === key)?.type).toContain(name);
    expect(component.props.find((prop) => prop.name === key)?.required).toBe(false);
  }
  expect(component.slots).toEqual([]);
});

it.each(['Snippet', 'Paint'])('preserves a native imported snippet alias %s', async (name) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'native-slot-')));
  roots.push(root);
  const path = join(root, 'Example.svelte');
  writeFileSync(
    path,
    `<script lang="ts">
    import type { Snippet as ${name} } from 'svelte';
    interface Base { payload: ${name}<[string]> }
    interface Inputs extends Base { count: number }
    let { payload, count }: Inputs = $props();
    </script><div>{@render payload('fixed')}{count}</div>`,
  );
  const component = (await extractSvelteComponents([path])).components[0]!;
  expect(component.props.map((prop) => prop.name)).toEqual(['payload', 'count']);
  expect(component.props.find((prop) => prop.name === 'payload')?.required).toBe(true);
  expect(component.props.find((prop) => prop.name === 'payload')?.type).toContain(name);
  expect(component.slots.map((slot) => slot.name)).toEqual(['payload']);
});

it.each(['payload', 'children'].flatMap((name) => [false, true].map((used) => ({ name, used }))))(
  'retains native $name input with render use $used',
  async ({ name, used }) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'snippet-input-')));
    roots.push(root);
    const path = join(root, 'Example.svelte');
    writeFileSync(
      path,
      `<script lang="ts">
      import type { Snippet as Paint } from 'svelte';
      interface Base { ${name}?: Paint<[string]> | null }
      interface Inputs extends Base { count: number }
      let { ${name} = null, count }: Inputs = $props();
      </script><div>${used ? `{@render ${name}?.('fixed')}` : 'fixed'}{count}</div>`,
    );
    const component = (await extractSvelteComponents([path])).components[0]!;
    expect(component.props.find((prop) => prop.name === name)).toMatchObject({
      name,
      required: false,
      defaultValue: 'null',
    });
    expect(component.props.find((prop) => prop.name === name)?.type).toContain('Paint');
    expect(component.slots).toEqual(used ? [expect.objectContaining({ name, isDefault: false })] : []);
  },
);

it.each([
  { binding: 'let { payload: paint }: Inputs = $props();', output: '{@render paint()}', rendered: true },
  { binding: 'let inputs: Inputs = $props();', output: '{@render inputs.payload()}', rendered: true },
  { binding: 'let inputs: Inputs = $props();', output: 'fixed', rendered: false },
  {
    binding: 'let { payload }: Inputs = $props();',
    output: '{#each [] as payload}{@render payload()}{/each}',
    rendered: false,
  },
  {
    binding: 'let { payload }: Inputs = $props();',
    output: '{#snippet local()}{@render payload()}{/snippet}fixed',
    rendered: false,
  },
  {
    binding: 'let { payload }: Inputs = $props();',
    output: '{#snippet local()}fixed{/snippet}{#if true}{@const payload = local}{@render payload()}{/if}',
    rendered: false,
  },
])('binds render syntax to its original input: $output', async ({ binding, output, rendered }) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'render-binding-')));
  roots.push(root);
  const path = join(root, 'Example.svelte');
  writeFileSync(
    path,
    `<script lang="ts">import type { Snippet as Paint } from 'svelte';
    interface Inputs { payload: Paint } ${binding}</script>${output}`,
  );
  const component = (await extractSvelteComponents([path])).components[0]!;
  expect(component.props).toEqual([expect.objectContaining({ name: 'payload', type: 'Paint', required: true })]);
  expect(component.slots).toEqual(rendered ? [{ name: 'payload', isDefault: false }] : []);
});

it('retains native input contracts and explicit template slots after type recovery', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'snippet-retry-')));
  roots.push(root);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['*.d.ts'] }),
  );
  writeFileSync(join(root, 'native.d.ts'), `declare module 'svelte' { export interface Snippet { (): unknown } }`);
  const path = join(root, 'Example.svelte');
  const source = `<script lang="ts">import type { Snippet as Paint } from 'svelte';
    interface Inputs { payload?: Paint | null }
    let { payload = null }: Inputs = $props();</script><slot name="header"/>`;
  writeFileSync(path, source);
  const component = (await extractSvelteComponents([path])).components[0]!;
  const ast = parse(source, { modern: true }) as unknown as AstNode;
  const instance = ast['instance'] as AstNode;
  const propsCall = findPropsCall(instance)!;
  component.reviewReasons = ['props-type-unresolved'];
  component.needsReview = true;
  await maybeRunResolveUnreachableRetry(
    [component],
    [],
    new Map([
      [
        path,
        {
          filePath: path,
          source,
          instance,
          moduleScript: undefined,
          annotation: getRetryAnnotation(propsCall)!,
          componentName: component.name,
        },
      ],
    ]),
    { projectRoot: root, resolveUnreachable: 'always' },
  );
  expect(component.props).toEqual([
    expect.objectContaining({ name: 'payload', type: 'Paint | null', required: false, defaultValue: 'null' }),
  ]);
  expect(component.slots).toEqual([{ name: 'header', isDefault: false }]);
  expect(component.reviewReasons).not.toContain('props-type-unresolved');
});

it('preserves an explicit default template slot when a rendered input has the same source name', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'explicit-slot-')));
  roots.push(root);
  const path = join(root, 'Example.svelte');
  writeFileSync(
    path,
    `<script lang="ts">import type { Snippet as Paint } from 'svelte';
    interface Inputs { default: Paint }
    let { default: paint }: Inputs = $props();</script><slot/>{@render paint()}`,
  );
  const component = (await extractSvelteComponents([path])).components[0]!;
  expect(component.props).toEqual([expect.objectContaining({ name: 'default', type: 'Paint', required: true })]);
  expect(component.slots).toEqual([{ name: 'default', isDefault: true }]);
});

it.each(['Snippet', 'Snippet<[string]>'])('retains an unbound type spelling %s', (text) => {
  expect(isSnippetTypeText(text, new Set())).toBe(false);
});

it.each(['Paint<[string]> | { value: string }', 'Paint<[string]>[]', 'Paint<', 'Paint; type Other = string'])(
  'does not turn the enclosing %s into a slot',
  (text) => {
    expect(isSnippetTypeText(text, new Set(['Paint']))).toBe(false);
  },
);

it('requires a resolved framework declaration rather than a matching folder and symbol name', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(
    '/example/svelte/types.ts',
    'interface Snippet { value: string } let value: Snippet;',
  );
  expect(typeRefersToSnippet(source.getVariableDeclarationOrThrow('value').getType())).toBe(false);
});

it('recognizes a resolved native snippet through an alias and namespace reference', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    '/example/native.d.ts',
    `declare module 'svelte' { export interface Snippet<T extends unknown[] = []> { (...args: T): unknown; } }`,
  );
  const source = project.createSourceFile(
    '/example/types.ts',
    `import type * as Native from 'svelte'; type Paint = Native.Snippet<[string]>; let value: Paint;`,
  );
  expect(typeRefersToSnippet(source.getVariableDeclarationOrThrow('value').getType())).toBe(true);
});

it('infers allowed components for a rendered snippet slot from its tuple type', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'snippet-allowed-')));
  roots.push(root);
  const write = (name: string, source: string) => {
    const path = join(root, `${name}.svelte`);
    writeFileSync(path, source);
    return path;
  };
  const leaf = (name: string) =>
    write(
      name,
      `<script lang="ts">
      interface ${name}Props { text: string }
      let { text }: ${name}Props = $props();
      </script><span>{text}</span>`,
    );
  const paths = [
    leaf('Heading'),
    leaf('A'),
    leaf('B'),
    write(
      'Card',
      `<script lang="ts">
      import type { Snippet } from 'svelte';
      interface HeadingProps { text: string }
      interface AProps { text: string }
      interface BProps { text: string }
      interface Props {
        header?: Snippet<[HeadingProps]>;
        content: Snippet<[AProps | BProps]>;
        footer?: Snippet<[HeadingProps]>;
        children?: Snippet;
      }
      let { header, content, footer, children }: Props = $props();
      </script><section>{@render header?.({ text: '' })}{@render content({ text: '' })}{@render children?.()}</section>`,
    ),
  ];
  const card = (await extractSvelteComponents(paths)).components.find((component) => component.name === 'Card')!;
  expect(card.slots).toEqual([
    { name: 'header', isDefault: false, allowedComponents: ['Heading'] },
    { name: 'content', isDefault: false, allowedComponents: ['A', 'B'] },
    { name: 'children', isDefault: false },
  ]);
  expect(card.props.map((prop) => prop.name)).toEqual(['header', 'content', 'footer', 'children']);
  for (const slot of card.slots) expect(slot).not.toHaveProperty('_rawTypeText');
});
