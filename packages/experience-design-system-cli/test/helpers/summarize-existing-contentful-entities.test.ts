import { describe, expect, it } from 'vitest';
import type { ComponentProps, DesignTokenProps } from 'contentful-management';
import {
  summarizeForSelectAgent,
  summarizeForGenerateAgent,
  summarizeForMapTokens,
} from '../../src/helpers/summarize-existing-contentful-entities.js';
import type { ExistingContentfulEntities } from '../../src/helpers/fetch-existing-contentful-entities.js';

function makeComponent(id: string, name: string, description = ''): ComponentProps {
  return {
    sys: { id } as ComponentProps['sys'],
    name,
    description,
    viewports: [],
    contentProperties: [],
    designProperties: [
      { id: 'variant', name: 'Variant', type: 'String' } as unknown as ComponentProps['designProperties'][number],
    ],
    slots: [],
  };
}

function makeToken(id: string, name: string, type: DesignTokenProps['type']): DesignTokenProps {
  return { sys: { id } as DesignTokenProps['sys'], name, type };
}

const emptyEntities: ExistingContentfulEntities = { components: [], tokens: [] };

describe('summarizeForSelectAgent', () => {
  it('returns empty summary for empty entities', () => {
    expect(summarizeForSelectAgent(emptyEntities)).toEqual({
      components: [],
      tokens: { count: 0, kinds: [] },
    });
  });

  it('maps components to id/name/description only', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Button', 'Primary CTA'), makeComponent('c2', 'Card')],
      tokens: [],
    };
    const summary = summarizeForSelectAgent(entities);
    expect(summary.components).toEqual([
      { id: 'c1', name: 'Button', description: 'Primary CTA' },
      { id: 'c2', name: 'Card', description: '' },
    ]);
  });

  it('rolls tokens up to count + sorted unique kinds', () => {
    const entities: ExistingContentfulEntities = {
      components: [],
      tokens: [
        makeToken('t1', 'brand.primary', 'DTCG.Color'),
        makeToken('t2', 'space.sm', 'DTCG.Dimension'),
        makeToken('t3', 'brand.secondary', 'DTCG.Color'),
      ],
    };
    expect(summarizeForSelectAgent(entities).tokens).toEqual({
      count: 3,
      kinds: ['DTCG.Color', 'DTCG.Dimension'],
    });
  });
});

describe('summarizeForGenerateAgent', () => {
  it('surfaces exact-name match as likelyMatch', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Button'), makeComponent('c2', 'Card')],
      tokens: [],
    };
    const summary = summarizeForGenerateAgent(entities, 'Button');
    expect(summary.likelyMatch?.id).toBe('c1');
    expect(summary.otherComponents).toEqual([{ id: 'c2', name: 'Card' }]);
  });

  it('matches after case/punctuation normalization', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'button_group')],
      tokens: [],
    };
    expect(summarizeForGenerateAgent(entities, 'ButtonGroup').likelyMatch?.id).toBe('c1');
  });

  it('folds plurals via trailing-s stripping', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Card')],
      tokens: [],
    };
    expect(summarizeForGenerateAgent(entities, 'Cards').likelyMatch?.id).toBe('c1');
  });

  it('matches within Levenshtein 2 (typo)', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Button')],
      tokens: [],
    };
    expect(summarizeForGenerateAgent(entities, 'Buttn').likelyMatch?.id).toBe('c1');
  });

  it('does NOT match when edit distance exceeds threshold', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Button')],
      tokens: [],
    };
    // Btn -> button is 4 edits after normalization, above threshold.
    expect(summarizeForGenerateAgent(entities, 'Btn').likelyMatch).toBeUndefined();
  });

  it('prefers closer match when multiple candidates are within threshold', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Buttons'), makeComponent('c2', 'Buttonz')],
      tokens: [],
    };
    // "Button" -> "Buttons" normalizes to same (plural strip), distance 0.
    // "Buttonz" normalizes to buttonz, distance 1.
    const summary = summarizeForGenerateAgent(entities, 'Button');
    expect(summary.likelyMatch?.id).toBe('c1');
  });

  it('projects likelyMatch design/content/slot shapes', () => {
    const c: ComponentProps = {
      ...makeComponent('c1', 'Button'),
      contentProperties: [
        {
          id: 'label',
          name: 'Label',
          type: 'Symbol',
          required: true,
        } as unknown as ComponentProps['contentProperties'][number],
      ],
      slots: [
        { id: 'icon', name: 'Icon', required: false, validations: [] } as unknown as NonNullable<
          ComponentProps['slots']
        >[number],
      ],
    };
    const summary = summarizeForGenerateAgent({ components: [c], tokens: [] }, 'Button');
    expect(summary.likelyMatch).toMatchObject({
      designProperties: [{ id: 'variant', name: 'Variant', type: 'String' }],
      contentProperties: [{ id: 'label', name: 'Label', type: 'Symbol' }],
      slots: [{ id: 'icon', name: 'Icon' }],
    });
  });

  it('lists all components in otherComponents when no match found', () => {
    const entities: ExistingContentfulEntities = {
      components: [makeComponent('c1', 'Hero'), makeComponent('c2', 'Card')],
      tokens: [],
    };
    const summary = summarizeForGenerateAgent(entities, 'Button');
    expect(summary.likelyMatch).toBeUndefined();
    expect(summary.otherComponents).toEqual([
      { id: 'c1', name: 'Hero' },
      { id: 'c2', name: 'Card' },
    ]);
  });
});

describe('summarizeForMapTokens', () => {
  it('projects tokens to id/name/type', () => {
    const entities: ExistingContentfulEntities = {
      components: [],
      tokens: [makeToken('t1', 'brand.primary', 'DTCG.Color'), makeToken('t2', 'space.sm', 'DTCG.Dimension')],
    };
    expect(summarizeForMapTokens(entities)).toEqual({
      tokens: [
        { id: 't1', name: 'brand.primary', type: 'DTCG.Color' },
        { id: 't2', name: 'space.sm', type: 'DTCG.Dimension' },
      ],
    });
  });
});
