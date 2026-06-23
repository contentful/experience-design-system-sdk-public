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

describe('SvelteComponentExtractor', () => {
  // ---------------------------------------------------------------------------
  // Basic $props() with inline interface
  // ---------------------------------------------------------------------------

  it('extracts $props() with inline Props interface (typed primitives)', async () => {
    // Pattern: skeleton-svelte / svelte-5-ui-lib canonical form.
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

  // ---------------------------------------------------------------------------
  // Snippet slots
  // ---------------------------------------------------------------------------

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
    // import { Snippet as S } — must still route to slots, not props.
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

  // ---------------------------------------------------------------------------
  // Legacy <slot> elements (Svelte 5 still parses them for compat)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Defaults, requiredness, allowedValues edge cases
  // ---------------------------------------------------------------------------

  it('captures source line numbers for each prop', async () => {
    const filePath = await writeFixture(
      'Card.svelte',
      `<script lang="ts">
  interface Props {
    title: string;
    body: string;
  }
  let { title, body }: Props = $props();
</script>
<div>{title}{body}</div>
`,
    );

    const result = await extractSvelteComponents([filePath]);
    const card = result.components[0]!;
    const title = card.props.find((p) => p.name === 'title')!;
    expect(title.sourceStartLine).toBe(3);
    expect(title.sourceEndLine).toBeGreaterThanOrEqual(3);
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
    // Edge case: interface says `name: string` (required) but destructure provides
    // a default. Required-ness in Svelte 5 is governed by whether the *caller* must pass —
    // a default in the destructure makes that "no". Treat as not-required.
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

  // ---------------------------------------------------------------------------
  // Unsupported / fallback / error paths
  // ---------------------------------------------------------------------------

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

  it('drops rest element and warns', async () => {
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
    expect(result.warnings.some((w) => /rest element/i.test(w))).toBe(true);
  });

  it('returns no component and warns on parse errors', async () => {
    const filePath = await writeFixture(
      'Broken.svelte',
      `<script lang="ts">let { foo = $props();</script>`,
    );

    const result = await extractSvelteComponents([filePath]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings.some((w) => /parse error/i.test(w))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Patterns observed in real corpus targets
  // ---------------------------------------------------------------------------

  it('handles svelte-5-ui-lib pattern: cross-file Props import alias', async () => {
    // import { type ButtonProps as Props } from '.';
    // We need ts-morph to follow the import; sibling file in same tempDir.
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
    // const props: AccordionRootProps = $props();
    // const [accordionProps, componentProps] = $derived(splitProps(props));
    // We only care about the $props() destructure-or-const result; splitProps
    // is downstream rewiring we ignore.
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
    // No destructure → no per-prop names from binding pattern.
    // Type annotation still gives us prop *names* from the interface, though defaults are absent.
    expect(c.props.map((p) => p.name).sort()).toEqual(['multiple', 'value']);
    expect(c.props.find((p) => p.name === 'multiple')!.required).toBe(false);
    expect(c.props.find((p) => p.name === 'multiple')!.defaultValue).toBeUndefined();
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
});
