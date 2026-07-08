import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractComponents } from '@contentful/experience-design-system-extraction';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-test-'));
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

describe('ComponentExtractorPipeline', () => {
  it('routes files to correct extractors and merges results', async () => {
    const reactFile = await writeFixture(
      'Button.tsx',
      `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `,
    );
    const vueFile = await writeFixture(
      'Card.vue',
      `
<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div>{{ title }}</div></template>
    `,
    );

    const result = await extractComponents([reactFile, vueFile]);
    expect(result.components).toHaveLength(2);
    expect(result.components.find((c) => c.name === 'Button')).toBeDefined();
    expect(result.components.find((c) => c.name === 'Card')).toBeDefined();
  });

  it('routes .svelte files through the Svelte extractor', async () => {
    const reactFile = await writeFixture(
      'Card.tsx',
      `
      export function Card({ title }: { title: string }) {
        return <div>{title}</div>;
      }
    `,
    );
    const svelteFile = await writeFixture(
      'Button.svelte',
      `
<script lang="ts">
  interface Props { label: string; disabled?: boolean }
  let { label, disabled = false }: Props = $props();
</script>
<button {disabled}>{label}</button>
    `,
    );

    const result = await extractComponents([reactFile, svelteFile]);
    expect(result.components).toHaveLength(2);
    const button = result.components.find((c) => c.name === 'Button')!;
    expect(button.framework).toBe('svelte');
    expect(button.props.find((p) => p.name === 'label')!.required).toBe(true);
    const card = result.components.find((c) => c.name === 'Card')!;
    expect(card.framework).toBe('react');
  });

  it('skips SvelteKit route files (+page.svelte, +layout.svelte, +error.svelte)', async () => {
    const page = await writeFixture(
      'src/routes/about/+page.svelte',
      `
<script lang="ts">
  let { data }: { data: unknown } = $props();
</script>
<div>{JSON.stringify(data)}</div>
    `,
    );
    const layout = await writeFixture(
      'src/routes/+layout.svelte',
      `
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>
<main>{@render children()}</main>
    `,
    );
    const error = await writeFixture(
      'src/routes/+error.svelte',
      `
<script lang="ts">
  let { message }: { message: string } = $props();
</script>
<p>{message}</p>
    `,
    );
    const component = await writeFixture(
      'src/lib/Button.svelte',
      `
<script lang="ts">
  interface Props { label: string }
  let { label }: Props = $props();
</script>
<button>{label}</button>
    `,
    );

    const result = await extractComponents([page, layout, error, component]);
    const names = result.components.map((c) => c.name);
    expect(names).toEqual(['Button']);
  });

  it('dedupes same-named components across Svelte and React in the same package by path preference', async () => {
    const svelteFile = await writeFixture(
      'packages/ui/src/components/Button/Button.svelte',
      `
<script lang="ts">
  interface Props { label: string }
  let { label }: Props = $props();
</script>
<button>{label}</button>
    `,
    );
    const reactFile = await writeFixture(
      'packages/ui/src/components/Button/Button.tsx',
      `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `,
    );

    const result = await extractComponents([svelteFile, reactFile]);
    // Same name + same package → dedup. Path-preference picks one;
    // we just assert exactly one Button survives.
    expect(result.components.filter((c) => c.name === 'Button')).toHaveLength(1);
  });

  it('routes Vue TSX files through the Vue TSX extractor without duplicating React results', async () => {
    const reactFile = await writeFixture(
      'Button.tsx',
      `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `,
    );
    const vueTsxFile = await writeFixture(
      'VBanner.tsx',
      `
      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function genericComponent<T = unknown>(_exposeDefaults?: boolean) {
        return (options: {
          name?: string;
          props?: unknown;
          setup?: (props: unknown, context: { slots: T }) => unknown;
        }) => options;
      }

      export const makeVBannerProps = propsFactory({
        title: String,
      }, 'VBanner');

      export const VBanner = genericComponent<{ default: never }>()({
        name: 'VBanner',
        props: makeVBannerProps(),
        setup (_props, { slots }) {
          return () => slots.default?.();
        },
      });
    `,
    );

    const result = await extractComponents([reactFile, vueTsxFile]);

    expect(result.components).toHaveLength(2);
    expect(result.components.find((c) => c.name === 'Button' && c.framework === 'react')).toBeDefined();
    expect(result.components.find((c) => c.name === 'VBanner' && c.framework === 'vue')).toBeDefined();
    expect(result.components.filter((c) => c.name === 'VBanner')).toHaveLength(1);
  });

  it('returns empty result for empty file list', async () => {
    const result = await extractComponents([]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('reports cross-package same-name components as collisions across extractors', async () => {
    const reactFile = await writeFixture(
      'Widget.tsx',
      `
      export function Widget() { return <div />; }
    `,
    );
    const astroFile = await writeFixture('Widget.astro', `<div />`);

    const result = await extractComponents([reactFile, astroFile]);
    expect(result.components.filter((component) => component.name === 'Widget')).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.startsWith('Component name collision "Widget"'))).toBe(true);
  });

  it('prefers index wrapper components over deeper duplicate implementations in the same package', async () => {
    const deepFile = await writeFixture(
      'packages/ui/Dropdown/components/Dropdown.tsx',
      `
      export function Dropdown({ variant }: { variant?: 'deep' }) {
        return <div data-variant={variant} />;
      }
    `,
    );
    const indexFile = await writeFixture(
      'packages/ui/Dropdown/index.tsx',
      `
      export function Dropdown({ tone }: { tone?: 'public' | 'neutral' }) {
        return <div data-tone={tone} />;
      }
    `,
    );

    const result = await extractComponents([deepFile, indexFile]);

    expect(result.components).toHaveLength(1);
    const dropdown = result.components[0];
    expect(dropdown.name).toBe('Dropdown');
    expect(dropdown.source).toBe(indexFile);
    expect(dropdown.props.find((p) => p.name === 'tone')?.allowedValues).toEqual(['neutral', 'public']);
    expect(dropdown.props.find((p) => p.name === 'variant')).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('Duplicate component "Dropdown"'))).toBe(true);
  });

  it('prefers shallower duplicate component paths when neither file is an index in the same family subtree', async () => {
    const nestedFile = await writeFixture(
      'packages/ui/Section/components/Section.tsx',
      `
      export function Section({ nested }: { nested?: boolean }) {
        return <section data-nested={nested} />;
      }
    `,
    );
    const shallowFile = await writeFixture(
      'packages/ui/Section.tsx',
      `
      export function Section({ label }: { label: string }) {
        return <section>{label}</section>;
      }
    `,
    );

    const result = await extractComponents([nestedFile, shallowFile]);

    expect(result.components).toHaveLength(1);
    const section = result.components[0];
    expect(section.source).toBe(shallowFile);
    expect(section.props.find((p) => p.name === 'label')?.type).toBe('string');
    expect(section.props.find((p) => p.name === 'nested')).toBeUndefined();
  });

  it('keeps cross-package same-name components as distinct outputs', async () => {
    const modalsBody = await writeFixture(
      'packages/modals/Body.tsx',
      `
      export function Body({ tone }: { tone?: 'modal' }) {
        return <div data-tone={tone} />;
      }
    `,
    );
    const chromeBody = await writeFixture(
      'packages/chrome/Body.tsx',
      `
      export function Body({ level }: { level?: number }) {
        return <div data-level={level} />;
      }
    `,
    );

    const result = await extractComponents([modalsBody, chromeBody]);
    const bodies = result.components.filter((component) => component.name === 'Body');

    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.source).sort()).toEqual([chromeBody, modalsBody].sort());
    expect(result.warnings.some((w) => w.startsWith('Component name collision "Body"'))).toBe(true);
  });

  it('keeps same-name React subcomponents distinct across different component families in one package', async () => {
    const actionListItem = await writeFixture(
      'packages/ui/ActionList/components/Item/Item.tsx',
      `
      export function Item({ action }: { action: string }) {
        return <button>{action}</button>;
      }
    `,
    );
    const navigationItem = await writeFixture(
      'packages/ui/Navigation/components/Item/Item.tsx',
      `
      export function Item({ href }: { href: string }) {
        return <a href={href} />;
      }
    `,
    );

    const result = await extractComponents([actionListItem, navigationItem]);
    const items = result.components.filter((component) => component.name === 'Item');

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.source).sort()).toEqual([actionListItem, navigationItem].sort());
    expect(result.warnings.some((w) => w.startsWith('Component name collision "Item"'))).toBe(true);
  });

  it('keeps nested family components distinct even when their names match a top-level family', async () => {
    const topLevelList = await writeFixture(
      'packages/ui/src/components/List/List.tsx',
      `
      export function List({ ordered }: { ordered?: boolean }) {
        return <ul data-ordered={ordered} />;
      }
    `,
    );
    const legacyTabsList = await writeFixture(
      'packages/ui/src/components/LegacyTabs/components/List/List.tsx',
      `
      export function List({ legacy }: { legacy?: boolean }) {
        return <div data-legacy={legacy} />;
      }
    `,
    );
    const tabsList = await writeFixture(
      'packages/ui/src/components/Tabs/components/List/List.tsx',
      `
      export function List({ tabs }: { tabs?: boolean }) {
        return <div data-tabs={tabs} />;
      }
    `,
    );

    const result = await extractComponents([topLevelList, legacyTabsList, tabsList]);
    const lists = result.components.filter((component) => component.name === 'List');

    expect(lists).toHaveLength(3);
    expect(lists.map((list) => list.source).sort()).toEqual([topLevelList, legacyTabsList, tabsList].sort());
    expect(result.warnings.some((w) => w.startsWith('Duplicate component "List"'))).toBe(false);
    expect(result.warnings.some((w) => w.startsWith('Component name collision "List"'))).toBe(true);
  });

  it('keeps same-name Vue subcomponents distinct across sibling families', async () => {
    const dataTableBodyCell = await writeFixture(
      'packages/primevue/src/datatable/BodyCell.vue',
      `
<script setup lang="ts">
defineProps<{ field: string }>();
</script>
<template><td>{{ field }}</td></template>
    `,
    );
    const treeTableBodyCell = await writeFixture(
      'packages/primevue/src/treetable/BodyCell.vue',
      `
<script setup lang="ts">
defineProps<{ nodeKey: string }>();
</script>
<template><td>{{ nodeKey }}</td></template>
    `,
    );

    const result = await extractComponents([dataTableBodyCell, treeTableBodyCell]);
    const bodyCells = result.components.filter((component) => component.name === 'BodyCell');

    expect(bodyCells).toHaveLength(2);
    expect(bodyCells.map((cell) => cell.source).sort()).toEqual([dataTableBodyCell, treeTableBodyCell].sort());
    expect(result.warnings.some((w) => w.startsWith('Component name collision "BodyCell"'))).toBe(true);
  });

  it('uses the parent directory name for top-level index.vue wrapper components', async () => {
    const buttonIndex = await writeFixture(
      'packages/ui/Button/index.vue',
      `
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template><button>{{ label }}</button></template>
    `,
    );

    const result = await extractComponents([buttonIndex]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.name).toBe('Button');
    expect(result.components[0]?.source).toBe(buttonIndex);
  });

  it('aggregates warnings from extractors', async () => {
    const badFile = await writeFixture('Bad.vue', `not valid vue content at all {{{`);
    const result = await extractComponents([badFile]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('routes Stencil .tsx files to Stencil extractor and React .tsx to React', async () => {
    const stencilFile = await writeFixture(
      'spinner.tsx',
      `
      import { Component, Prop, h } from '@stencil/core';

      @Component({ tag: 'p-spinner', shadow: true })
      export class Spinner {
        @Prop() public size?: string = 'small';

        render() { return <span />; }
      }
    `,
    );
    const reactFile = await writeFixture(
      'Button.tsx',
      `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `,
    );

    const result = await extractComponents([stencilFile, reactFile]);
    expect(result.components).toHaveLength(2);

    const spinner = result.components.find((c) => c.name === 'PSpinner');
    expect(spinner).toBeDefined();
    expect(spinner!.framework).toBe('stencil');

    const button = result.components.find((c) => c.name === 'Button');
    expect(button).toBeDefined();
    expect(button!.framework).toBe('react');
  });

  it('passes TypeScript dependency context files into React extraction', async () => {
    const sharedProps = await writeFixture(
      'packages/ui/shared.ts',
      `
      export interface SharedProps {
        className?: string;
        testId?: string;
      }
      `,
    );
    const reactFile = await writeFixture(
      'packages/ui/AssetIcon.tsx',
      `
      import type { SharedProps } from './shared';

      export type AssetIconProps = SharedProps & {
        type?: 'asset' | 'icon';
      };

      export function AssetIcon({ className, testId, type = 'asset' }: AssetIconProps) {
        return <div data-class-name={className} data-test-id={testId} data-type={type} />;
      }
      `,
    );

    const result = await extractComponents([reactFile, sharedProps]);
    const assetIcon = result.components.find((component) => component.name === 'AssetIcon');

    expect(assetIcon?.props.find((prop) => prop.name === 'className')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon?.props.find((prop) => prop.name === 'testId')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon?.props.find((prop) => prop.name === 'type')).toEqual(
      expect.objectContaining({
        type: '"asset" | "icon"',
        required: false,
        allowedValues: ['asset', 'icon'],
        defaultValue: 'asset',
      }),
    );
  });

  it('filters out hook-named web component classes and emits a warning', async () => {
    const hookLikeWebComponent = await writeFixture(
      'useFilter.js',
      `
      export class useFilter extends HTMLElement {
        static get observedAttributes() { return ['value']; }
        connectedCallback() {}
      }
      customElements.define('use-filter', useFilter);
      `,
    );

    const result = await extractComponents([hookLikeWebComponent]);

    expect(result.components.find((c) => c.name === 'useFilter')).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('Skipped hook: useFilter'))).toBe(true);
  });

  it('does not filter exports that start with uppercase Use', async () => {
    const file = await writeFixture(
      'packages/ui/src/UseCounter.tsx',
      `
      export function UseCounter({ count }: { count: number }) {
        return <span>{count}</span>;
      }
      `,
    );

    const result = await extractComponents([file]);
    expect(result.components.find((c) => c.name === 'UseCounter')).toBeDefined();
    expect(result.warnings.some((w) => w.includes('Skipped hook'))).toBe(false);
  });
});
