import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractSvelteComponents } from '../../../src/analyze/extract/svelte.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'svelte-extract-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function writeUnresolvedPropsFixture(
  filename: string,
  componentTypeName: string,
  options: { moduleScriptExtras?: string; heritage?: string } = {},
): Promise<string> {
  const heritage = options.heritage ?? `Omit<ExtPkgProps, 'id'>`;
  const extras = options.moduleScriptExtras ?? '';
  return writeFixture(
    filename,
    `
<script lang="ts" module>
  import type { Props as ExtPkgProps } from '@some-headless-pkg/accordion';
  ${extras}
  export interface ${componentTypeName} extends ${heritage} {}
</script>
<script lang="ts">
  const props: ${componentTypeName} = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
  );
}

describe('SvelteComponentExtractor', () => {
  it('extracts $props() with inline Props interface (typed primitives)', async () => {
    const filePath = await writeFixture(
      'Button.svelte',
      `
<script lang="ts">
  interface Props {
    /** Visual style variant */
    variant?: 'primary' | 'secondary' | 'danger';
    /** Disable interactions */
    disabled?: boolean;
    /** Required label */
    label: string;
    /** Click handler */
    onclick?: (e: MouseEvent) => void;
  }

  let {
    variant = 'primary',
    disabled = false,
    label,
    onclick,
  }: Props = $props();
</script>

<button class="btn btn-{variant}" {disabled} {onclick}>{label}</button>
`,
    );

    const result = await extractSvelteComponents([filePath]);

    expect(result.warnings).toEqual([]);
    expect(result.components).toHaveLength(1);
    const button = result.components[0]!;
    expect(button.name).toBe('Button');
    expect(button.framework).toBe('svelte');
    expect(button.slots).toEqual([]);

    const variant = button.props.find((p) => p.name === 'variant')!;
    expect(variant.required).toBe(false);
    expect(variant.type).toBe(`'primary' | 'secondary' | 'danger'`);
    expect(variant.allowedValues).toEqual(['primary', 'secondary', 'danger']);
    expect(variant.defaultValue).toBe(`'primary'`);
    expect(variant.description).toBe('Visual style variant');

    const disabled = button.props.find((p) => p.name === 'disabled')!;
    expect(disabled.type).toBe('boolean');
    expect(disabled.defaultValue).toBe('false');
    expect(disabled.required).toBe(false);

    const label = button.props.find((p) => p.name === 'label')!;
    expect(label.type).toBe('string');
    expect(label.required).toBe(true);
    expect(label.defaultValue).toBeUndefined();
  });

  it('extracts inline type-literal $props() (no named interface)', async () => {
    const filePath = await writeFixture(
      'Tag.svelte',
      `
<script lang="ts">
  let { label, count = 0 }: { label: string; count?: number } = $props();
</script>
<span>{label} ({count})</span>
`,
    );

    const result = await extractSvelteComponents([filePath]);

    expect(result.components).toHaveLength(1);
    const tag = result.components[0]!;
    expect(tag.props.find((p) => p.name === 'label')!.required).toBe(true);
    expect(tag.props.find((p) => p.name === 'count')!.type).toBe('number');
    expect(tag.props.find((p) => p.name === 'count')!.defaultValue).toBe('0');
  });

  it('routes Snippet-typed props to slots; children → default slot', async () => {
    const filePath = await writeFixture(
      'Layout.svelte',
      `
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Optional header */
    header?: Snippet;
    /** Default content */
    children: Snippet;
    /** Footer with year arg (arg dropped) */
    footer?: Snippet<[year: number]>;
  }

  let { header, children, footer }: Props = $props();
</script>

<div class="layout">
  {#if header}<header>{@render header()}</header>{/if}
  <main>{@render children()}</main>
  {#if footer}<footer>{@render footer(2026)}</footer>{/if}
</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);

    expect(result.warnings).toEqual([]);
    const layout = result.components[0]!;
    expect(layout.props).toEqual([]);
    expect(layout.slots).toHaveLength(3);

    const headerSlot = layout.slots.find((s) => s.name === 'header')!;
    expect(headerSlot.isDefault).toBe(false);
    expect(headerSlot.description).toBe('Optional header');

    const defaultSlot = layout.slots.find((s) => s.name === 'children')!;
    expect(defaultSlot.isDefault).toBe(true);
    expect(defaultSlot.description).toBe('Default content');

    const footerSlot = layout.slots.find((s) => s.name === 'footer')!;
    expect(footerSlot.isDefault).toBe(false);
    expect(footerSlot.description).toBe('Footer with year arg (arg dropped)');
  });

  it('separates regular props from Snippet-typed slots in mixed components', async () => {
    const filePath = await writeFixture(
      'Modal.svelte',
      `
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    children: Snippet;
    actions?: Snippet;
  }

  let { open, title, children, actions }: Props = $props();
</script>
{#if open}<div>{title}{@render children()}{#if actions}{@render actions()}{/if}</div>{/if}
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const modal = result.components[0]!;

    expect(modal.props.map((p) => p.name).sort()).toEqual(['open', 'title']);
    expect(modal.slots.map((s) => s.name).sort()).toEqual(['actions', 'children']);
    expect(modal.slots.find((s) => s.name === 'children')!.isDefault).toBe(true);
  });

  it('detects Snippet under an aliased import', async () => {
    const filePath = await writeFixture(
      'Aliased.svelte',
      `
<script lang="ts">
  import type { Snippet as S } from 'svelte';
  let { children }: { children: S } = $props();
</script>
{@render children()}
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props).toEqual([]);
    expect(c.slots).toHaveLength(1);
    expect(c.slots[0]!.name).toBe('children');
    expect(c.slots[0]!.isDefault).toBe(true);
  });

  it('extracts legacy <slot> elements from the template', async () => {
    const filePath = await writeFixture(
      'CardWithSlot.svelte',
      `
<script lang="ts">
  interface Props {
    title: string;
  }
  let { title }: Props = $props();
</script>
<article>
  <h2>{title}</h2>
  <slot />
  <slot name="footer" />
</article>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const card = result.components[0]!;
    expect(card.props.map((p) => p.name)).toEqual(['title']);
    expect(card.slots.map((s) => s.name).sort()).toEqual(['default', 'footer']);
    expect(card.slots.find((s) => s.name === 'default')!.isDefault).toBe(true);
    expect(card.slots.find((s) => s.name === 'footer')!.isDefault).toBe(false);
  });

  it('warns and prefers Snippet entry when both <slot> and Snippet are present', async () => {
    const filePath = await writeFixture(
      'Mixed.svelte',
      `
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>
<div>{@render children()}<slot /></div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.components[0]!.slots).toHaveLength(1);
    expect(result.components[0]!.slots[0]!.name).toBe('children');
    expect(result.warnings.some((w) => /mixed.*slot/i.test(w))).toBe(true);
  });

  it('marks prop required when no default and no optional flag', async () => {
    const filePath = await writeFixture(
      'Strict.svelte',
      `
<script lang="ts">
  interface Props { id: string; }
  let { id }: Props = $props();
</script>
<span>{id}</span>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.components[0]!.props[0]!.required).toBe(true);
  });

  it('marks prop optional when default present even if interface field is non-optional', async () => {
    const filePath = await writeFixture(
      'Defaulted.svelte',
      `
<script lang="ts">
  interface Props { name: string; }
  let { name = 'Anon' }: Props = $props();
</script>
<span>{name}</span>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const prop = result.components[0]!.props[0]!;
    expect(prop.required).toBe(false);
    expect(prop.defaultValue).toBe(`'Anon'`);
  });

  it('emits unsupported-syntax warning for Svelte 4 export let components', async () => {
    const filePath = await writeFixture(
      'LegacyV4.svelte',
      `
<script lang="ts">
  export let label: string;
  export let disabled: boolean = false;
</script>
<button {disabled}>{label}</button>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings.some((w) => /Svelte 4.*not yet supported/i.test(w))).toBe(true);
  });

  it('returns component with empty props and warns when $props() is called without destructure', async () => {
    const filePath = await writeFixture(
      'Untyped.svelte',
      `
<script lang="ts">
  const props = $props();
</script>
<pre>{JSON.stringify(props)}</pre>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.props).toEqual([]);
    expect(result.warnings.some((w) => /without destructuring/i.test(w))).toBe(true);
  });

  it('extracts named destructure props and silently ignores rest spread', async () => {
    const filePath = await writeFixture(
      'WithRest.svelte',
      `
<script lang="ts">
  interface Props { foo: string; bar?: number; }
  let { foo, ...rest }: Props = $props();
</script>
<span>{foo}</span>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props.map((p) => p.name)).toEqual(['foo']);
    expect(result.warnings.some((w) => /rest element/i.test(w))).toBe(false);
  });

  it('returns no component and warns on parse errors', async () => {
    const filePath = await writeFixture('Broken.svelte', `<script lang="ts">let { foo = $props();</script>`);

    const result = await extractSvelteComponents([filePath]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings.some((w) => /parse error/i.test(w))).toBe(true);
  });

  it('follows cross-file re-export chains (named re-export)', async () => {
    await writeFixture(
      'type.ts',
      `
export interface ButtonProps {
  /** Color theme */
  color?: 'red' | 'blue';
  /** Disable interactions */
  disabled?: boolean;
}
`,
    );
    await writeFixture('index.ts', `export { type ButtonProps } from './type.js';\n`);
    const filePath = await writeFixture(
      'Button.svelte',
      `
<script lang="ts">
  import { type ButtonProps as Props } from './index.js';
  let { color = 'blue', disabled = false }: Props = $props();
</script>
<button {disabled}>{color}</button>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const button = result.components[0]!;
    const color = button.props.find((p) => p.name === 'color')!;
    expect(color.type).toBe(`'red' | 'blue'`);
    expect(color.allowedValues).toEqual(['red', 'blue']);
    expect(color.defaultValue).toBe(`'blue'`);
    expect(color.description).toBe('Color theme');
    expect(button.props.find((p) => p.name === 'disabled')!.type).toBe('boolean');
  });

  it('follows namespace re-exports (export * from ...)', async () => {
    await writeFixture(
      'type.ts',
      `
export interface CardProps {
  /** Header text */
  title: string;
  variant?: 'compact' | 'wide';
}
`,
    );
    await writeFixture('index.ts', `export * from './type.js';\n`);
    const filePath = await writeFixture(
      'Card.svelte',
      `
<script lang="ts">
  import { type CardProps as Props } from './index.js';
  let { title, variant = 'compact' }: Props = $props();
</script>
<div>{title}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const card = result.components[0]!;
    const title = card.props.find((p) => p.name === 'title')!;
    expect(title.type).toBe('string');
    expect(title.required).toBe(true);
    expect(title.description).toBe('Header text');
    const variant = card.props.find((p) => p.name === 'variant')!;
    expect(variant.allowedValues).toEqual(['compact', 'wide']);
  });

  it('honors aliased Snippet import in cross-file resolution', async () => {
    await writeFixture(
      'type.ts',
      `
import type { Snippet as LocalSnippet } from 'svelte';

export interface AliasedProps {
  /** Title text */
  title: string;
  /** Header slot */
  header?: LocalSnippet;
}
`,
    );
    await writeFixture('index.ts', `export * from './type.js';\n`);
    const filePath = await writeFixture(
      'Aliased.svelte',
      `
<script lang="ts">
  import { type AliasedProps as Props } from './index.js';
  let { title, header }: Props = $props();
</script>
<div>{title}{#if header}{@render header()}{/if}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const component = result.components[0]!;

    expect(component.props.find((p) => p.name === 'header')).toBeUndefined();
    const headerSlot = component.slots.find((s) => s.name === 'header')!;
    expect(headerSlot).toBeDefined();
    expect(headerSlot.isDefault).toBe(false);

    const title = component.props.find((p) => p.name === 'title')!;
    expect(title.type).toBe('string');
  });

  it('handles svelte-5-ui-lib pattern: cross-file Props import alias', async () => {
    await writeFixture(
      'index.ts',
      `
export interface ButtonProps {
  /** Color theme */
  color?: 'red' | 'blue';
  /** Disable */
  disabled?: boolean;
}
`,
    );
    const filePath = await writeFixture(
      'Button.svelte',
      `
<script lang="ts">
  import { type ButtonProps as Props } from './index.js';
  let { color = 'blue', disabled = false }: Props = $props();
</script>
<button {disabled}>{color}</button>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const button = result.components[0]!;
    const color = button.props.find((p) => p.name === 'color')!;
    expect(color.allowedValues).toEqual(['red', 'blue']);
    expect(color.defaultValue).toBe(`'blue'`);
    expect(color.description).toBe('Color theme');
  });

  it('handles skeleton-svelte pattern: $props() bound to const, then splitProps via $derived', async () => {
    const filePath = await writeFixture(
      'AccordionRoot.svelte',
      `
<script lang="ts">
  interface AccordionRootProps {
    /** Multi-select mode */
    multiple?: boolean;
    /** Initial value */
    value?: string[];
  }
  const props: AccordionRootProps = $props();
</script>
<div data-multiple={props.multiple}>{props.value}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props.map((p) => p.name).sort()).toEqual(['multiple', 'value']);
    expect(c.props.find((p) => p.name === 'multiple')!.required).toBe(false);
    expect(c.props.find((p) => p.name === 'multiple')!.defaultValue).toBeUndefined();
  });

  it('resolves props from a local interface that extends another local interface', async () => {
    const filePath = await writeFixture(
      'Extended.svelte',
      `
<script lang="ts">
  interface Base {
    /** Base id */
    id: string;
    /** Common toggle */
    enabled?: boolean;
  }
  interface Props extends Base {
    /** Extended-only label */
    label: string;
  }
  let { id, enabled = true, label }: Props = $props();
</script>
<div>{id}{label}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    const names = c.props.map((p) => p.name).sort();
    expect(names).toEqual(['enabled', 'id', 'label']);
    const id = c.props.find((p) => p.name === 'id')!;
    expect(id.type).toBe('string');
    expect(id.required).toBe(true);
    expect(id.description).toBe('Base id');
    const enabled = c.props.find((p) => p.name === 'enabled')!;
    expect(enabled.required).toBe(false);
    expect(enabled.defaultValue).toBe('true');
  });

  it('resolves Omit<T, K> in extends', async () => {
    const filePath = await writeFixture(
      'OmitExt.svelte',
      `
<script lang="ts">
  interface Base { id: string; secret: string; label: string }
  interface Props extends Omit<Base, 'secret'> {}
  let { id, label }: Props = $props();
</script>
<div>{id}{label}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    const names = c.props.map((p) => p.name).sort();
    expect(names).toEqual(['id', 'label']);
    expect(names).not.toContain('secret');
  });

  it('resolves intersection types', async () => {
    const filePath = await writeFixture(
      'Intersect.svelte',
      `
<script lang="ts">
  type A = { a: string };
  type B = { b: number };
  let { a, b }: A & B = $props();
</script>
<div>{a}{b}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    const names = c.props.map((p) => p.name).sort();
    expect(names).toEqual(['a', 'b']);
    expect(c.props.find((p) => p.name === 'a')!.type).toBe('string');
    expect(c.props.find((p) => p.name === 'b')!.type).toBe('number');
  });

  it('resolves Partial<T> wrapping (every prop becomes optional)', async () => {
    const filePath = await writeFixture(
      'PartialProps.svelte',
      `
<script lang="ts">
  interface Base { id: string; label: string }
  type Props = Partial<Base>;
  let { id, label }: Props = $props();
</script>
<div>{id}{label}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props.find((p) => p.name === 'id')!.required).toBe(false);
    expect(c.props.find((p) => p.name === 'label')!.required).toBe(false);
  });

  it('warns and flags review when a typed Props interface resolves to zero properties', async () => {
    const filePath = await writeUnresolvedPropsFixture('Skeletonish.svelte', 'SkeletonishProps');

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props).toEqual([]);
    expect(c.reviewReasons).toContain('props-type-unresolved');
    expect(c.needsReview).toBe(true);
    expect(result.warnings.some((w) => w.includes('Skeletonish.svelte') && /resolved to 0 properties/i.test(w))).toBe(
      true,
    );
  });

  it('warns on partial resolution: heritage clauses extend unreachable types and only Snippet-typed members resolve', async () => {
    const filePath = await writeUnresolvedPropsFixture('PartiallyResolved.svelte', 'PartiallyResolvedProps', {
      moduleScriptExtras: `import type { Snippet } from 'svelte'; interface PropsWithEl { element: Snippet }`,
      heritage: `Omit<ExtPkgProps, 'id'>, PropsWithEl`,
    });

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.reviewReasons).toContain('props-type-unresolved');
    expect(c.needsReview).toBe(true);
    expect(
      result.warnings.some(
        (w) => w.includes('PartiallyResolved.svelte') && /resolved to/i.test(w) && /heritage/i.test(w),
      ),
    ).toBe(true);
  });

  it('warnings start with the component name so the TUI can group them', async () => {
    const filePath = await writeFixture(
      'accordion/anatomy/root.svelte',
      `
<script lang="ts" module>
  import type { Props as ExtPkgProps } from '@unreachable-pkg/foo';
  export interface AccordionRootProps extends Omit<ExtPkgProps, 'id'> {}
</script>
<script lang="ts">
  const props: AccordionRootProps = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const w of result.warnings) {
      expect(w).toMatch(/^AccordionRoot:/);
    }
  });

  it('replaces per-component warnings with a single summary when 3+ share the unresolved-type pattern', async () => {
    const make = (name: string) =>
      writeFixture(
        `${name}/anatomy/root.svelte`,
        `
<script lang="ts" module>
  import type { Props as ExtPkgProps } from '@unreachable-pkg/foo';
  export interface ${name}RootProps extends Omit<ExtPkgProps, 'id'> {}
</script>
<script lang="ts">
  const props: ${name}RootProps = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
      );

    const files = await Promise.all([make('Accordion'), make('Dialog'), make('Slider'), make('Combobox')]);
    const result = await extractSvelteComponents(files);
    expect(result.components).toHaveLength(4);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Unresolved component types: 4 components/);
  });

  it('does not collapse when fewer than 3 components share the pattern', async () => {
    const make = (name: string) =>
      writeFixture(
        `${name}/anatomy/root.svelte`,
        `
<script lang="ts" module>
  import type { Props as ExtPkgProps } from '@unreachable-pkg/foo';
  export interface ${name}RootProps extends Omit<ExtPkgProps, 'id'> {}
</script>
<script lang="ts">
  const props: ${name}RootProps = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
      );

    const files = await Promise.all([make('Accordion'), make('Dialog')]);
    const result = await extractSvelteComponents(files);
    expect(result.components).toHaveLength(2);
    expect(result.warnings.some((w) => /^Unresolved component types:/.test(w))).toBe(false);
  });

  it('detects Snippet via type-checker alias symbol when text expands to instantiated form', async () => {
    const filePath = await writeFixture(
      'WithGenericSnippet.svelte',
      `
<script lang="ts" module>
  import type { Snippet } from 'svelte';
  type Attrs<T> = { kind: T };
  interface Props {
    /** Render-the-element snippet (instantiated through generics) */
    element: Snippet<[Attrs<HTMLDivElement>]>;
    /** Plain Snippet */
    plain?: Snippet;
    /** Real prop */
    label: string;
  }
</script>
<script lang="ts">
  const props: Props = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props.map((p) => p.name).sort()).toEqual(['label']);
    expect(c.slots.map((s) => s.name).sort()).toEqual(['element', 'plain']);
    expect(c.props.some((p) => p.name === 'element')).toBe(false);
    expect(c.props.some((p) => p.name === 'plain')).toBe(false);
  });

  it('uses the declared type-node text to detect Snippet even when the resolver gives up', async () => {
    const filePath = await writeFixture(
      'WithSnippetGeneric.svelte',
      `
<script lang="ts" module>
  import type { Snippet } from 'svelte';
  type Attrs<T> = { kind: T };
  interface Props {
    /** May be unresolved by the checker but the annotation says Snippet */
    element: Snippet<[Attrs<HTMLDivElement>]>;
    label: string;
  }
</script>
<script lang="ts">
  const props: Props = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props.map((p) => p.name)).toEqual(['label']);
    expect(c.slots.map((s) => s.name)).toEqual(['element']);
    expect(c.props.some((p) => p.name === 'element')).toBe(false);
  });

  it('collapse drops per-component lines when summarizing 3+ unresolved-type warnings', async () => {
    const make = (name: string) =>
      writeFixture(
        `${name}/anatomy/root.svelte`,
        `
<script lang="ts" module>
  import type { Props as ExtPkgProps } from '@unreachable-pkg/foo';
  export interface ${name}RootProps extends Omit<ExtPkgProps, 'id'> {}
</script>
<script lang="ts">
  const props: ${name}RootProps = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
      );

    const files = await Promise.all([make('Accordion'), make('Dialog'), make('Slider'), make('Combobox')]);
    const result = await extractSvelteComponents(files);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Unresolved component types: 4 components/);

    for (const c of result.components) {
      expect(c.reviewReasons).toContain('props-type-unresolved');
      expect(c.needsReview).toBe(true);
    }
  });

  it('Snippet-only recovery clears props-type-unresolved (the type DID resolve, just to slots)', async () => {
    await writeFixture(
      'lib/local-types.ts',
      `
import type { Snippet } from 'svelte';
export interface AnchorProps {
  /** Render-the-element snippet */
  element: Snippet;
}
`,
    );
    const filePath = await writeFixture(
      'Anchor.svelte',
      `
<script lang="ts" module>
  import type { AnchorProps } from './lib/local-types.js';
</script>
<script lang="ts">
  const props: AnchorProps = $props();
</script>
<div>{JSON.stringify(props)}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.slots.map((s) => s.name)).toContain('element');
    expect(c.props).toEqual([]);
    expect(c.reviewReasons ?? []).not.toContain('props-type-unresolved');
  });

  it('does not warn when the user genuinely typed an empty type literal', async () => {
    const filePath = await writeFixture(
      'IntentionallyEmpty.svelte',
      `
<script lang="ts">
  const _: {} = $props();
</script>
<div>static</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const c = result.components[0]!;
    expect(c.props).toEqual([]);
    expect(c.reviewReasons ?? []).not.toContain('props-type-unresolved');
    expect(result.warnings.some((w) => /resolved to 0 properties/i.test(w))).toBe(false);
  });

  it('namespaces components under an anatomy/ folder by their grandparent dir', async () => {
    const accRoot = await writeFixture(
      'accordion/anatomy/root.svelte',
      `<script lang="ts">interface P{a:string}let{a}:P=$props()</script><div>{a}</div>`,
    );
    const dlgRoot = await writeFixture(
      'dialog/anatomy/root.svelte',
      `<script lang="ts">interface P{b:string}let{b}:P=$props()</script><div>{b}</div>`,
    );
    const accCloseTrigger = await writeFixture(
      'accordion/anatomy/close-trigger.svelte',
      `<script lang="ts">interface P{c:string}let{c}:P=$props()</script><div>{c}</div>`,
    );

    const result = await extractSvelteComponents([accRoot, dlgRoot, accCloseTrigger]);
    const names = result.components.map((c) => c.name).sort();
    expect(names).toEqual(['AccordionCloseTrigger', 'AccordionRoot', 'DialogRoot']);
  });

  it('namespaces components under a parts/ folder the same way', async () => {
    const filePath = await writeFixture(
      'menu/parts/trigger.svelte',
      `<script lang="ts">interface P{x:string}let{x}:P=$props()</script><div>{x}</div>`,
    );
    const result = await extractSvelteComponents([filePath]);
    expect(result.components[0]!.name).toBe('MenuTrigger');
  });

  it('does not namespace ordinary nested components (no anatomy/parts marker)', async () => {
    const filePath = await writeFixture(
      'accordion/root.svelte',
      `<script lang="ts">interface P{a:string}let{a}:P=$props()</script><div>{a}</div>`,
    );
    const result = await extractSvelteComponents([filePath]);
    expect(result.components[0]!.name).toBe('Root');
  });

  it('extracts component name from filename, not interface name', async () => {
    const filePath = await writeFixture(
      'Avatar/index.svelte',
      `
<script lang="ts">
  interface AvatarRootProps { src: string; }
  let { src }: AvatarRootProps = $props();
</script>
<img {src} alt="" />
`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.components[0]!.name).toBe('Avatar');
  });

  async function writeUnresolvedFixtures(total: number, unresolved: number): Promise<string[]> {
    const paths: string[] = [];
    for (let i = 0; i < total; i++) {
      const isUnresolved = i < unresolved;
      const name = `Comp${i}`;
      if (isUnresolved) {
        paths.push(
          await writeFixture(
            `${name}.svelte`,
            `
<script lang="ts">
  import type { ExternalThing } from '@unresolvable/missing-package-${i}';
  interface Props extends ExternalThing {}
  let props: Props = $props();
</script>
<div></div>
`,
          ),
        );
      } else {
        paths.push(
          await writeFixture(
            `${name}.svelte`,
            `
<script lang="ts">
  interface Props { local: string; }
  let { local }: Props = $props();
</script>
<div>{local}</div>
`,
          ),
        );
      }
    }
    return paths;
  }

  it('resolve-unreachable=auto skips when unresolved ratio is below 20%', async () => {
    const filePaths = await writeUnresolvedFixtures(6, 1);
    const result = await extractSvelteComponents(filePaths, undefined, {
      resolveUnreachable: 'auto',
      projectRoot: tempDir,
    });
    expect(result.warnings.some((w) => w.startsWith('Unresolved-type retry pass'))).toBe(false);
    expect(result.warnings.some((w) => /declared Props type .* resolved to/.test(w))).toBe(true);
  });

  it('resolve-unreachable=auto triggers when unresolved ratio is ≥20%', async () => {
    const filePaths = await writeUnresolvedFixtures(5, 2);
    await writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext' } }));

    const result = await extractSvelteComponents(filePaths, undefined, {
      resolveUnreachable: 'auto',
      projectRoot: tempDir,
    });
    expect(result.warnings.some((w) => w.startsWith('Unresolved-type retry pass (mode=auto)'))).toBe(true);
  });

  it('resolve-unreachable=never never retries even when everything is unresolved', async () => {
    const filePaths = await writeUnresolvedFixtures(4, 4);
    await writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext' } }));

    const result = await extractSvelteComponents(filePaths, undefined, {
      resolveUnreachable: 'never',
      projectRoot: tempDir,
    });
    expect(result.warnings.some((w) => w.startsWith('Unresolved-type retry pass'))).toBe(false);
  });

  it('resolve-unreachable=always retries even at low unresolved ratios', async () => {
    const filePaths = await writeUnresolvedFixtures(4, 1);
    await writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext' } }));

    const result = await extractSvelteComponents(filePaths, undefined, {
      resolveUnreachable: 'always',
      projectRoot: tempDir,
    });
    expect(result.warnings.some((w) => w.startsWith('Unresolved-type retry pass (mode=always)'))).toBe(true);
  });

  it('tsconfig pass recovers a component whose Props extends a path-alias type', async () => {
    await writeFile(
      join(tempDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          baseUrl: '.',
          paths: { '$lib/*': ['lib/*'] },
        },
      }),
    );
    await writeFixture('lib/types.ts', `export interface BaseProps { label: string; tone?: 'info' | 'danger'; }`);
    const filePath = await writeFixture(
      'Card.svelte',
      `
<script lang="ts">
  import type { BaseProps } from '$lib/types';
  interface Props extends BaseProps {}
  let props: Props = $props();
</script>
<div></div>
`,
    );

    const result = await extractSvelteComponents([filePath], undefined, {
      resolveUnreachable: 'always',
      projectRoot: tempDir,
    });
    const card = result.components[0]!;
    const propNames = card.props.map((p) => p.name).sort();
    expect(propNames).toContain('label');
    expect(card.reviewReasons ?? []).not.toContain('props-type-unresolved');
    expect(result.warnings.some((w) => /Card: declared Props type .* resolved to/.test(w))).toBe(false);
    expect(result.warnings.some((w) => w.startsWith('Unresolved-type retry pass'))).toBe(true);
  });

  it('node_modules pass adds .d.ts from a fake package and recovers props', async () => {
    await mkdir(join(tempDir, 'node_modules/fake-svelte-pkg'), { recursive: true });
    await writeFile(
      join(tempDir, 'node_modules/fake-svelte-pkg/package.json'),
      JSON.stringify({ name: 'fake-svelte-pkg', main: 'index.js', types: 'index.d.ts' }),
    );
    await writeFile(join(tempDir, 'node_modules/fake-svelte-pkg/index.js'), `module.exports = {};`);
    await writeFile(
      join(tempDir, 'node_modules/fake-svelte-pkg/index.d.ts'),
      `export interface FakeProps { color: string; size?: 'sm' | 'md' | 'lg'; }`,
    );

    const filePath = await writeFixture(
      'Widget.svelte',
      `
<script lang="ts">
  import type { FakeProps } from 'fake-svelte-pkg';
  interface Props extends FakeProps {}
  let props: Props = $props();
</script>
<div></div>
`,
    );

    const result = await extractSvelteComponents([filePath], undefined, {
      resolveUnreachable: 'always',
      projectRoot: tempDir,
    });
    const widget = result.components[0]!;
    const propNames = widget.props.map((p) => p.name).sort();
    expect(propNames).toEqual(expect.arrayContaining(['color']));
    expect(widget.reviewReasons ?? []).not.toContain('props-type-unresolved');
  });
});

describe('extractSvelteComponents — $allowedComponents from Snippet<[XProps]>', () => {
  it('populates slot.allowedComponents from Snippet<[HeadingProps]>', async () => {
    const headingPath = await writeFixture(
      'Heading.svelte',
      `
<script lang="ts">
  export interface HeadingProps {
    text: string;
  }
  let { text }: HeadingProps = $props();
</script>
<h1>{text}</h1>
`,
    );
    const cardPath = await writeFixture(
      'Card.svelte',
      `
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HeadingProps } from './Heading.svelte';

  interface Props {
    header?: Snippet<[HeadingProps]>;
    children: Snippet;
  }

  let { header, children }: Props = $props();
</script>
<section>
  {#if header}<header>{@render header({ text: 'hi' })}</header>{/if}
  <main>{@render children()}</main>
</section>
`,
    );

    const result = await extractSvelteComponents([headingPath, cardPath]);
    const card = result.components.find((c) => c.name === 'Card')!;
    const headerSlot = card.slots.find((s) => s.name === 'header')!;
    expect(headerSlot.allowedComponents).toEqual(['Heading']);

    const defaultSlot = card.slots.find((s) => s.name === 'children')!;
    expect(defaultSlot.allowedComponents).toBeUndefined();
  });
});
