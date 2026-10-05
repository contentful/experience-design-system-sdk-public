import { describe, expect, it } from 'vitest';
import { extractAstroComponents } from '../../src/extract/framework-adapters/astro/extractor.js';
import { extractReactComponents } from '../../src/extract/framework-adapters/react/extractor.js';
import { extractStencilComponents } from '../../src/extract/framework-adapters/stencil/extractor.js';
import { extractSvelteComponents } from '../../src/extract/framework-adapters/svelte/extractor.js';
import { extractVueTsxComponents } from '../../src/extract/framework-adapters/vue-tsx/extractor.js';
import { extractVueComponents } from '../../src/extract/framework-adapters/vue/extractor.js';
import { extractWebComponentDefinitions } from '../../src/extract/framework-adapters/web-components/extractor.js';
import { kebabToPascal } from '../../src/extract/framework-adapters/shared/helpers/tsx-shared.js';
import { resolveBestFunctionNode } from '../../src/extract/framework-adapters/react/helpers/resolve-component-function.js';
import { collectPropDataflow } from '../../src/extract/framework-adapters/react/helpers/collect-prop-dataflow.js';
import { extractClassProperties, mergePropLists } from '../../src/extract/framework-adapters/web-components/helpers/merge-wc-prop-lists.js';
import { getSvelteComponentName } from '../../src/extract/framework-adapters/svelte/helpers/get-svelte-component-name.js';
import { mergeSlots } from '../../src/extract/framework-adapters/svelte/helpers/extract-svelte-template-slots.js';
import { extractorRegistry } from '../../src/extract/services/extraction/helpers/register-extractors.js';

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
