import { describe, expect, it } from 'vitest';
import type { CDFDocument } from '@contentful/experience-design-system-types';
import { describeDroppedTokenDefaults, dropDanglingTokenDefaults } from '../../src/apply/dangling-token-defaults.js';

const SCHEMA = 'https://contentful.com/schemas/cdf' as CDFDocument['$schema'];

function button(): CDFDocument {
  return {
    $schema: SCHEMA,
    Button: {
      $type: 'component',
      $properties: {
        color: { $type: 'token', $category: 'design', $default: 'color.primary', $token: { kind: 'color' } },
        label: { $type: 'string', $category: 'content', $default: 'Button' },
      },
    },
  } as unknown as CDFDocument;
}

describe('dropDanglingTokenDefaults', () => {
  it('removes a token default when the token is not in the environment or the CDF', () => {
    const { cdf, dropped } = dropDanglingTokenDefaults(button(), new Set());

    const properties = (cdf['Button'] as { $properties: Record<string, Record<string, unknown>> }).$properties;
    expect(properties['color']).not.toHaveProperty('$default');
    expect(properties['color']).toMatchObject({ $type: 'token', $category: 'design' });
    expect(dropped).toEqual([{ component: 'Button', property: 'color', token: 'color.primary' }]);
  });

  it('keeps the default when the environment already has the token', () => {
    const { cdf, dropped } = dropDanglingTokenDefaults(button(), new Set(['color.primary']));

    const properties = (cdf['Button'] as { $properties: Record<string, Record<string, unknown>> }).$properties;
    expect(properties['color']?.['$default']).toBe('color.primary');
    expect(dropped).toEqual([]);
  });

  it('keeps the default when the CDF defines the token itself', () => {
    const doc = button();
    (doc as Record<string, unknown>)['color'] = { primary: { $type: 'color', $value: '#0057ff' } };

    const { cdf, dropped } = dropDanglingTokenDefaults(doc, new Set());

    const properties = (cdf['Button'] as { $properties: Record<string, Record<string, unknown>> }).$properties;
    expect(properties['color']?.['$default']).toBe('color.primary');
    expect(dropped).toEqual([]);
  });

  it('never touches non-token properties', () => {
    const { cdf } = dropDanglingTokenDefaults(button(), new Set());

    const properties = (cdf['Button'] as { $properties: Record<string, Record<string, unknown>> }).$properties;
    expect(properties['label']?.['$default']).toBe('Button');
  });

  it('finds components nested in groups and does not modify its input', () => {
    const doc = {
      $schema: SCHEMA,
      forms: {
        Input: {
          $type: 'component',
          $properties: { tone: { $type: 'token', $category: 'design', $default: 'tone.calm' } },
        },
      },
    } as unknown as CDFDocument;
    const before = JSON.stringify(doc);

    const { dropped } = dropDanglingTokenDefaults(doc, new Set());

    expect(dropped).toEqual([{ component: 'forms.Input', property: 'tone', token: 'tone.calm' }]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('describes what was left out in plain language', () => {
    expect(describeDroppedTokenDefaults([{ component: 'Button', property: 'color', token: 'color.primary' }])).toEqual([
      'Button.color: default "color.primary" left out — that design token does not exist in this environment',
    ]);
  });
});
