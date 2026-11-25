import { expect, it } from 'vitest';
import type { ComponentTypeSummary } from '@contentful/experience-design-system-types';
import { computeComponentDiffLines } from '../../../src/tui/import/steps/10-flow/support/preview-diff.js';

const current = (type: string, category: 'content' | 'design'): ComponentTypeSummary => ({
  id: 'example',
  name: 'Example',
  contentProperties: category === 'content' ? ['body'] : [],
  designProperties: category === 'design' ? ['body'] : [],
  slots: [],
  fullProperties: { body: { type, category, required: false } },
});
const proposed = (category: 'content' | 'design') => ({
  definition: { $type: 'component', $properties: { body: { $type: 'richtext', $category: category } }, $slots: {} },
});
const diff = (type: string, category: 'content' | 'design') =>
  computeComponentDiffLines(current(type, category), proposed(category)).map((line) => line.text);

it('treats content richtext as unchanged against a stored RichText property', () => {
  expect(diff('RichText', 'content')).toEqual([]);
});

it('shows content richtext as a type change against a stored String property', () => {
  expect(diff('String', 'content')).toEqual([
    '- body: String, content, optional',
    '+ body: richtext, content, optional',
  ]);
});

it('keeps design richtext equal to a stored String property', () => {
  expect(diff('String', 'design')).toEqual([]);
});
