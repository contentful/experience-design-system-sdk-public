import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  extractComponents,
  extractEndpoint,
  preClassifyComponent,
  evaluateExtractionQuality,
} from '../../../src/index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(name: string, source: string, extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'scoreless-extraction-'));
  roots.push(root);
  for (const [path, content] of Object.entries({ [name]: source, ...extra })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, path: join(root, name) };
}
it.each([
  ['Panel.tsx', 'export function Panel({ label }: { label: string }) { return <div>{label}</div>; }'],
  [
    'Panel.vue',
    '<script setup lang="ts">defineProps<{ label: string }>();</script><template><div>{{ label }}</div></template>',
  ],
  [
    'panel.ts',
    "export class Panel extends HTMLElement { label: string = 'example'; } customElements.define('example-panel', Panel);",
  ],
  [
    'Panel.svelte',
    '<script lang="ts">interface Props { label: string }; let { label }: Props = $props();</script><div>{label}</div>',
  ],
])('omits score in actual %s endpoint while preserving ordinary extraction observations', async (name, source) => {
  const { root, path } = fixture(name!, source!);
  const raw = await extractComponents([path], undefined, { projectRoot: root, resolveUnreachable: 'never' });
  const result = await extractEndpoint({ filePaths: [path], projectRoot: root, resolveUnreachable: 'never' });
  expect(result.components).toHaveLength(1);
  expect(result.extractionDiagnostics).toEqual(raw.extractionDiagnostics);
  expect(result.warnings).toEqual(raw.warnings);
  for (const component of result.components) {
    expect(component).not.toHaveProperty('extractionConfidence');
    const original = preClassifyComponent(raw.components.find((item) => item.name === component.name)!);
    expect(component.props).toEqual(original.props);
    expect(component.slots).toEqual(original.slots);
    expect(component.sourceCandidates).toEqual(original.sourceCandidates);
    expect(component.componentFacts).toEqual(original.componentFacts);
  }
});
it('keeps explicit reasons deduplicated and does not generate score-only reasons or review thresholds', async () => {
  const { path } = fixture('Panel.tsx', 'export function Panel() { return <div/>; }');
  const props = Array.from({ length: 55 }, (_, index) => ({
    name: `value${index}`,
    type: index === 0 ? 'any' : 'string | number | boolean',
    required: false,
  }));
  const result = await evaluateExtractionQuality([
    { name: 'Panel', source: path, framework: 'react', props, slots: [], needsReview: false, reviewReasons: [] },
  ]);
  expect(result.components[0]).not.toHaveProperty('extractionConfidence');
  expect(result.components[0]!.needsReview).toBe(false);
  expect(result.components[0]!.reviewReasons).toEqual([]);
  const lowScoreOnly = await evaluateExtractionQuality([
    {
      name: 'Panel',
      source: path,
      framework: 'react',
      props,
      slots: [],
      needsReview: false,
      reviewReasons: ['operator-note'],
    },
  ]);
  expect(lowScoreOnly.components[0]!.needsReview).toBe(false);
  expect(lowScoreOnly.components[0]!.reviewReasons).toEqual(['operator-note']);
  const retained = await evaluateExtractionQuality([
    {
      name: 'Panel',
      source: path,
      framework: 'react',
      props,
      slots: [],
      needsReview: true,
      reviewReasons: ['props-type-unresolved', 'props-type-unresolved', 'operator-note'],
    },
  ]);
  expect(retained.components[0]!.needsReview).toBe(true);
  expect(retained.components[0]!.reviewReasons).toEqual(['props-type-unresolved', 'operator-note']);
});
