import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractVueComponents } from '../../../src/analyze/extract/vue.js';

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

describe('VueComponentExtractor', () => {
  it('extracts defineProps<T>() generic syntax', async () => {
    const filePath = await writeFixture(
      'BaseButton.vue',
      `
<script setup lang="ts">
defineProps<{
  label: string;
  count?: number;
}>();
</script>
<template>
  <button>{{ label }} ({{ count }})</button>
</template>
    `,
    );

    const result = await extractVueComponents([filePath]);
    expect(result.components).toHaveLength(1);
    const button = result.components[0];
    expect(button.name).toBe('BaseButton');
    expect(button.framework).toBe('vue');

    const labelProp = button.props.find((p) => p.name === 'label');
    expect(labelProp!.required).toBe(true);
    expect(labelProp!.type).toBe('string');

    const countProp = button.props.find((p) => p.name === 'count');
    expect(countProp!.required).toBe(false);
    expect(countProp!.type).toBe('number');
  });

  it('uses the parent directory name for index.vue wrapper components', async () => {
    const filePath = await writeFixture(
      'Button/index.vue',
      `
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template>
  <button>{{ label }}</button>
</template>
    `,
    );

    const result = await extractVueComponents([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.name).toBe('Button');
  });

  it('extracts defineProps({...}) object syntax', async () => {
    const filePath = await writeFixture(
      'ColorPicker.vue',
      `
<script setup>
const props = defineProps({
  color: { type: String, required: true, default: '#000' },
  size: { type: Number, default: 16 },
});
</script>
<template><div :style="{ color }">pick</div></template>
    `,
    );

    const result = await extractVueComponents([filePath]);
    const cp = result.components[0];
    expect(cp.props.find((p) => p.name === 'color')!.required).toBe(true);
    expect(cp.props.find((p) => p.name === 'color')!.defaultValue).toBe('#000');
    expect(cp.props.find((p) => p.name === 'size')!.type).toBe('number');
  });

  it('extracts Options API props', async () => {
    const filePath = await writeFixture(
      'LegacyCard.vue',
      `
<script>
export default {
  props: {
    title: { type: String, required: true },
    collapsed: { type: Boolean, default: false },
  },
};
</script>
<template><div>{{ title }}</div></template>
    `,
    );

    const result = await extractVueComponents([filePath]);
    const card = result.components[0];
    expect(card.props).toHaveLength(2);
    expect(card.props.find((p) => p.name === 'title')!.required).toBe(true);
  });

  it('merges props from locally extended Vue base components', async () => {
    const basePath = await writeFixture(
      'BaseAccordion.vue',
      `
<script>
export default {
  props: {
    value: {
      type: [String, Number],
      default: undefined,
    },
    multiple: {
      type: Boolean,
      default: false,
    },
  },
};
</script>
      `,
    );

    const filePath = await writeFixture(
      'Accordion.vue',
      `
<script>
import BaseAccordion from './BaseAccordion.vue';

export default {
  extends: BaseAccordion,
  props: {
    lazy: {
      type: Boolean,
      default: false,
    },
  },
};
</script>
<template><div><slot /></div></template>
      `,
    );

    const result = await extractVueComponents([basePath, filePath]);
    const accordion = result.components.find((component) => component.name === 'Accordion');

    expect(accordion).toBeDefined();
    expect(accordion!.props.find((p) => p.name === 'value')!.type).toBe('any');
    expect(accordion!.props.find((p) => p.name === 'multiple')!.defaultValue).toBe('false');
    expect(accordion!.props.find((p) => p.name === 'lazy')!.defaultValue).toBe('false');
  });

  it('filters underscore-prefixed implementation props inherited through Vue extends chains', async () => {
    const basePath = await writeFixture(
      'BaseDialog.vue',
      `
<script>
export default {
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    _instance: null,
  },
};
</script>
      `,
    );

    const filePath = await writeFixture(
      'Dialog.vue',
      `
<script>
import BaseDialog from './BaseDialog.vue';

export default {
  extends: BaseDialog,
};
</script>
<template><div /></template>
      `,
    );

    const result = await extractVueComponents([basePath, filePath]);
    const dialog = result.components.find((component) => component.name === 'Dialog');

    expect(dialog).toBeDefined();
    expect(dialog!.props.find((p) => p.name === 'visible')).toBeDefined();
    expect(dialog!.props.find((p) => p.name === '_instance')).toBeUndefined();
  });

  it('extracts default and named slots', async () => {
    const filePath = await writeFixture(
      'Layout.vue',
      `
<script setup></script>
<template>
  <div>
    <slot />
    <slot name="sidebar" />
  </div>
</template>
    `,
    );

    const result = await extractVueComponents([filePath]);
    const layout = result.components[0];
    expect(layout.slots).toContainEqual({ name: 'default', isDefault: true });
    expect(layout.slots).toContainEqual({ name: 'sidebar', isDefault: false });
  });

  it('extracts kebab-case slot names from runtime bracket access', async () => {
    const filePath = await writeFixture(
      'RuntimeSlots.vue',
      `
<script setup lang="ts">
const hasBanner = Boolean($slots['hero-banner']);
</script>
<template>
  <div v-if="hasBanner">
    <component :is="$slots['hero-banner']" />
  </div>
</template>
      `,
    );

    const result = await extractVueComponents([filePath]);
    const runtimeSlots = result.components[0];

    expect(runtimeSlots.slots).toContainEqual({
      name: 'hero-banner',
      isDefault: false,
    });
  });

  it('merges locally imported object-spread props in defineProps object syntax', async () => {
    const helperPath = await writeFixture(
      'cvId.js',
      `
export const props = {
  id: String,
};
      `,
    );

    const filePath = await writeFixture(
      'DatePickerSkeleton.vue',
      `
<script setup>
import { props as propsCvId } from './cvId.js';

const props = defineProps({
  formItem: { type: Boolean, default: true },
  label: { type: Boolean, default: true },
  kind: {
    type: String,
    default: 'simple',
  },
  ...propsCvId,
});
</script>
<template><div /></template>
      `,
    );

    const result = await extractVueComponents([helperPath, filePath]);
    const skeleton = result.components[0];

    expect(skeleton.props.find((p) => p.name === 'formItem')).toBeDefined();
    expect(skeleton.props.find((p) => p.name === 'id')).toMatchObject({
      name: 'id',
      type: 'string',
      required: false,
    });
  });

  it('setup props win when both script blocks exist', async () => {
    const filePath = await writeFixture(
      'Hybrid.vue',
      `
<script>
export default {
  props: { legacy: { type: String } },
};
</script>
<script setup lang="ts">
defineProps<{ modern: string }>();
</script>
<template><div /></template>
    `,
    );

    const result = await extractVueComponents([filePath]);
    const hybrid = result.components[0];
    expect(hybrid.props.find((p) => p.name === 'modern')).toBeDefined();
    expect(hybrid.props.find((p) => p.name === 'legacy')).toBeUndefined();
  });

  it('captures sourcePath and per-prop source line ranges (Feature 1)', async () => {
    // Options API path uses parseObjectProps which carries ts-morph line numbers.
    // Note: line numbers are relative to the parsed <script> chunk, not the full .vue file.
    const filePath = await writeFixture(
      'OptCard.vue',
      `<script>
export default {
  props: {
    label: { type: String, required: true },
    count: { type: Number, required: false }
  }
}
</script>
<template><div /></template>
`,
    );

    const result = await extractVueComponents([filePath]);
    const card = result.components[0];
    expect(card.sourcePath).toBe(filePath);
    const labelProp = card.props.find((p) => p.name === 'label');
    const countProp = card.props.find((p) => p.name === 'count');
    expect(labelProp?.sourceStartLine).toBeGreaterThan(0);
    expect(countProp?.sourceStartLine).toBeGreaterThan(labelProp!.sourceStartLine!);
  });
});
