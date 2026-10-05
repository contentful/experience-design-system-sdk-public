import { describe, expect, it } from 'vitest';
import { extractAstroComponents } from '../src/extract/adapters/astro/extractor.js';
import { extractReactComponents } from '../src/extract/adapters/react/extractor.js';
import { extractStencilComponents } from '../src/extract/adapters/stencil/extractor.js';
import { extractSvelteComponents } from '../src/extract/adapters/svelte/extractor.js';
import { extractVueTsxComponents } from '../src/extract/adapters/vue-tsx/extractor.js';
import { extractVueComponents } from '../src/extract/adapters/vue/extractor.js';
import { extractWebComponentDefinitions } from '../src/extract/adapters/web-components/extractor.js';
import { kebabToPascal } from '../src/extract/adapters/support/tsx-shared.js';
import { resolveBestFunctionNode } from '../src/extract/adapters/react/function-resolution.js';
import { collectPropDataflow } from '../src/extract/adapters/react/prop-dataflow.js';
import { extractClassProperties, mergePropLists } from '../src/extract/adapters/web-components/merge-wc-prop-lists.js';
import { getSvelteComponentName } from '../src/extract/adapters/svelte/identity.js';
import { mergeSlots } from '../src/extract/adapters/svelte/slots.js';
import { extractorRegistry } from '../src/extract/services/extractor-registry.js';

describe('framework adapter boundaries', () => {
  it('keeps each framework implementation behind its adapter directory', () => {
    expect(
      [
        extractReactComponents,
        extractVueComponents,
        extractVueTsxComponents,
        extractAstroComponents,
        extractSvelteComponents,
        extractStencilComponents,
        extractWebComponentDefinitions,
      ].every((extractor) => typeof extractor === 'function'),
    ).toBe(true);
  });

  it('keeps shared TSX mechanics in the adapter-support boundary', () => {
    expect(kebabToPascal('content-card')).toBe('ContentCard');
  });

  it('keeps React function resolution and prop dataflow as adapter seams', () => {
    expect(typeof resolveBestFunctionNode).toBe('function');
    expect(typeof collectPropDataflow).toBe('function');
  });

  it('keeps Web Component property metadata as an adapter seam', () => {
    expect(typeof extractClassProperties).toBe('function');
    expect(mergePropLists([{ name: 'label', type: 'string', required: false }])).toEqual([
      { name: 'label', type: 'string', required: false },
    ]);
  });

  it('keeps Svelte identity and slot composition as adapter seams', () => {
    expect(getSvelteComponentName('/project/components/card/index.svelte')).toBe('Card');
    expect(mergeSlots([{ name: 'children', isDefault: true }], [{ name: 'header', isDefault: false }])).toEqual({
      slots: [
        { name: 'children', isDefault: true },
        { name: 'header', isDefault: false },
      ],
      mixedWarning: false,
    });
  });

  it('preserves ordered framework registration at the service boundary', () => {
    expect(extractorRegistry.map(({ name }) => name)).toEqual([
      'stencil',
      'react',
      'vue-tsx',
      'vue',
      'astro',
      'web-components',
      'svelte',
    ]);
  });
});
