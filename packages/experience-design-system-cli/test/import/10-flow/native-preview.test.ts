import { PALETTE } from '../../../src/tui/theme.js';
import { expect, it } from 'vitest';
import { computeComponentDiffLines } from '../../../src/tui/import/steps/10-flow/support/preview-diff.js';
const definition = JSON.parse(
  '{"$type":"record","$required":false,"$fields":{"a":{"$type":"number","$required":true},"__proto__":{"$type":"boolean","$required":false}}}',
);
const current = (shape?: unknown) => ({
  id: 'example',
  name: 'Example',
  contentProperties: ['data'],
  designProperties: [],
  slots: [],
  fullProperties: {
    data: { type: 'record', category: 'content', required: false, ...(shape ? { definition: shape } : {}) },
  },
});
it('compares supplied recursive metadata by value and exact child requiredness', () => {
  const next = { $type: 'component', $properties: { data: { ...definition, $category: 'content' } } };
  expect(computeComponentDiffLines(current(definition) as never, next)).toEqual([]);
  const reordered = { ...definition, $fields: Object.fromEntries(Object.entries(definition.$fields).reverse()) };
  expect(computeComponentDiffLines(current(reordered) as never, next)).toEqual([]);
  const changed = JSON.parse(JSON.stringify(definition));
  changed.$fields.a.$required = false;
  expect(computeComponentDiffLines(current(changed) as never, next)).toHaveLength(2);
});
it('shows unknown shape when old/remote summaries omit structure', () => {
  expect(
    computeComponentDiffLines(current() as never, { $properties: { data: { ...definition, $category: 'content' } } }),
  ).toMatchObject([{ color: PALETTE.warning }]);
});
