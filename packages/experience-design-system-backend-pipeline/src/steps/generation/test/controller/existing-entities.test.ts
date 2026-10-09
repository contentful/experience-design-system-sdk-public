import { describe, expect, it } from 'vitest';
import { summarizeForSelect } from '../../src/controller/existing-entities/summarize-for-select.js';
import { summarizeForGenerate } from '../../src/controller/existing-entities/summarize-for-generate.js';
import { summarizeForMapTokens } from '../../src/controller/existing-entities/summarize-for-map-tokens.js';
import { findNearlyMatchingComponent } from '../../src/helpers/existing-entities/find-nearly-matching-component.js';
import type { ExistingContentfulEntities } from '../../src/types/existing-entities.js';

const entities = {
  components: [
    {
      sys: { id: 'c-btn' },
      name: 'Button',
      description: 'A clickable thing',
      designProperties: [{ id: 'variant', name: 'variant', type: 'string' }],
      contentProperties: [{ id: 'label', name: 'label', type: 'string' }],
      slots: [{ id: 'icon', name: 'icon' }],
    },
    {
      sys: { id: 'c-card' },
      name: 'Card',
      description: '',
      designProperties: [],
      contentProperties: [],
      slots: [],
    },
  ],
  tokens: [
    { sys: { id: 't-color' }, name: 'brand/primary', type: 'color' },
    { sys: { id: 't-dim' }, name: 'spacing/md', type: 'dimension' },
  ],
} as unknown as ExistingContentfulEntities;

describe('summarizeForSelect', () => {
  it('projects components to id/name/description + token count/kinds', () => {
    const r = summarizeForSelect({ entities });
    expect(r.components).toHaveLength(2);
    expect(r.tokens).toEqual({ count: 2, kinds: ['color', 'dimension'] });
  });
});

describe('summarizeForGenerate', () => {
  it('picks the likely-matching component by fuzzy name (within 2-edit budget)', () => {
    const r = summarizeForGenerate({ entities, codebaseComponentName: 'Buttons' });
    expect(r.likelyMatch?.name).toBe('Button');
    expect(r.otherComponents).toHaveLength(1);
  });
  it('returns undefined likelyMatch when no component is within the edit budget', () => {
    const r = summarizeForGenerate({ entities, codebaseComponentName: 'Nothing' });
    expect(r.likelyMatch).toBeUndefined();
    expect(r.otherComponents).toHaveLength(2);
  });
});

describe('summarizeForMapTokens', () => {
  it('projects tokens to id/name/type', () => {
    const r = summarizeForMapTokens({ entities });
    expect(r.tokens).toEqual([
      { id: 't-color', name: 'brand/primary', type: 'color' },
      { id: 't-dim', name: 'spacing/md', type: 'dimension' },
    ]);
  });
});

describe('findNearlyMatchingComponent', () => {
  it('matches with up to 2 char edits after name simplification', () => {
    const match = findNearlyMatchingComponent(entities.components, 'card');
    expect(match?.name).toBe('Card');
  });
  it('returns undefined when no component is close enough', () => {
    expect(findNearlyMatchingComponent(entities.components, 'Something very different')).toBeUndefined();
  });
});
