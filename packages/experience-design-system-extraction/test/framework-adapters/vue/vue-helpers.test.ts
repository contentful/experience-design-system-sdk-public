import { describe, expect, it } from 'vitest';
import { resolveVueComponentName } from '../../../src/extract/framework-adapters/vue/helpers/resolve-vue-component-name.js';
import { isPublicVuePropName } from '../../../src/extract/framework-adapters/vue/helpers/extract-vue-options-props.js';
import {
  extractSlotsFromVueTemplate,
  collectRuntimeAccessSlots,
  mergeVueSlots,
} from '../../../src/extract/framework-adapters/vue/helpers/extract-vue-slots.js';

describe('resolveVueComponentName', () => {
  it('returns the file basename without .vue extension', () => {
    expect(resolveVueComponentName('/src/components/Button.vue')).toBe('Button');
  });

  it('uses the parent directory name for index.vue files', () => {
    expect(resolveVueComponentName('/src/components/Card/index.vue')).toBe('Card');
  });

  it('returns the parent directory name even when dirname returns "."', () => {
    // dirname('index.vue') === '.' and basename('.') === '.' — truthy, so returns '.'
    expect(resolveVueComponentName('index.vue')).toBe('.');
  });
});

describe('isPublicVuePropName', () => {
  it('returns true for normal prop names', () => {
    expect(isPublicVuePropName('label')).toBe(true);
    expect(isPublicVuePropName('variant')).toBe(true);
  });

  it('returns false for underscore-prefixed names', () => {
    expect(isPublicVuePropName('_internal')).toBe(false);
  });

  it('returns false for dollar-prefixed names', () => {
    expect(isPublicVuePropName('$emit')).toBe(false);
  });
});

describe('extractSlotsFromVueTemplate', () => {
  const ELEMENT_TYPE = 1;
  const ATTRIBUTE_TYPE = 6;

  it('extracts a default slot from a bare <slot> element', () => {
    const ast = {
      type: ELEMENT_TYPE,
      tag: 'slot',
      props: [],
      children: [],
    };
    expect(extractSlotsFromVueTemplate(ast as never)).toEqual([{ name: 'default', isDefault: true }]);
  });

  it('extracts a named slot', () => {
    const ast = {
      type: ELEMENT_TYPE,
      tag: 'slot',
      props: [{ type: ATTRIBUTE_TYPE, name: 'name', value: { content: 'header' } }],
      children: [],
    };
    expect(extractSlotsFromVueTemplate(ast as never)).toEqual([{ name: 'header', isDefault: false }]);
  });

  it('deduplicates slots with the same name', () => {
    const slotEl = { type: ELEMENT_TYPE, tag: 'slot', props: [], children: [] };
    const ast = { type: ELEMENT_TYPE, tag: 'div', props: [], children: [slotEl, slotEl] };
    expect(extractSlotsFromVueTemplate(ast as never)).toHaveLength(1);
  });

  it('returns empty array for a non-slot root element with no slot children', () => {
    const ast = { type: ELEMENT_TYPE, tag: 'div', props: [], children: [] };
    expect(extractSlotsFromVueTemplate(ast as never)).toEqual([]);
  });
});

describe('collectRuntimeAccessSlots', () => {
  it('detects $slots.default dot access', () => {
    expect(collectRuntimeAccessSlots('<div v-if="$slots.default">fallback</div>')).toEqual([
      { name: 'default', isDefault: true },
    ]);
  });

  it('detects $slots["header"] bracket access', () => {
    expect(collectRuntimeAccessSlots('$slots["header"]')).toEqual([{ name: 'header', isDefault: false }]);
  });

  it('deduplicates the same slot name', () => {
    const result = collectRuntimeAccessSlots('$slots.footer && $slots.footer');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('footer');
  });

  it('returns empty array when no $slots access found', () => {
    expect(collectRuntimeAccessSlots('<div>hello</div>')).toEqual([]);
  });
});

describe('mergeVueSlots', () => {
  it('keeps slots from both arrays when names are distinct', () => {
    const base = [{ name: 'default', isDefault: true }];
    const extra = [{ name: 'header', isDefault: false }];
    expect(mergeVueSlots(base, extra)).toHaveLength(2);
  });

  it('does not duplicate a slot that already exists in base', () => {
    const base = [{ name: 'header', isDefault: false }];
    const extra = [{ name: 'header', isDefault: false }];
    expect(mergeVueSlots(base, extra)).toHaveLength(1);
  });
});
