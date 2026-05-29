import { describe, it, expect } from 'vitest';
import {
  computeComponentDiffLines,
  diffProperty,
  formatOldProp,
  formatPropDef,
} from '../../src/import/tui/steps/preview-diff.js';
import type { ComponentTypeSummary, PropertySummary } from '@contentful/experience-design-system-types';

function makeCurrent(overrides: Partial<ComponentTypeSummary> = {}): ComponentTypeSummary {
  return {
    id: 'test-component',
    name: 'TestComponent',
    contentProperties: [],
    designProperties: [],
    slots: [],
    ...overrides,
  };
}

describe('formatOldProp', () => {
  it('formats a full property definition', () => {
    expect(formatOldProp({ type: 'Boolean', category: 'design', required: false })).toBe('Boolean, design, optional');
  });

  it('formats required property', () => {
    expect(formatOldProp({ type: 'Symbol', category: 'content', required: true })).toBe('Symbol, content, required');
  });

  it('includes default value', () => {
    expect(formatOldProp({ type: 'Symbol', category: 'design', required: false, default: 'primary' })).toBe(
      'Symbol, design, optional, default="primary"',
    );
  });

  it('omits empty type and category', () => {
    expect(formatOldProp({ type: '', category: '', required: true })).toBe('required');
  });
});

describe('formatPropDef', () => {
  it('formats a proposed property definition', () => {
    expect(formatPropDef({ $type: 'boolean', $category: 'design', $required: false })).toBe(
      'boolean, design, optional',
    );
  });

  it('formats required with default', () => {
    expect(formatPropDef({ $type: 'text', $category: 'content', $required: true, $default: 'hello' })).toBe(
      'text, content, required, default="hello"',
    );
  });

  it('omits missing fields', () => {
    expect(formatPropDef({})).toBe('optional');
  });
});

describe('diffProperty', () => {
  const old: PropertySummary = { type: 'Boolean', category: 'design', required: false };

  it('returns empty when nothing changed', () => {
    const result = diffProperty('flag', old, { $type: 'Boolean', $category: 'design', $required: false });
    expect(result).toEqual([]);
  });

  it('detects required change', () => {
    const result = diffProperty('flag', old, { $type: 'Boolean', $category: 'design', $required: true });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ color: 'red', text: '- flag: Boolean, design, optional' });
    expect(result[1]).toMatchObject({ color: 'green', text: '+ flag: Boolean, design, required' });
  });

  it('detects type change', () => {
    const result = diffProperty('size', old, { $type: 'number', $category: 'design', $required: false });
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toContain('- size: Boolean');
    expect(result[1]!.text).toContain('+ size: number');
  });

  it('detects category change', () => {
    const result = diffProperty('label', old, { $type: 'Boolean', $category: 'content', $required: false });
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toContain('design');
    expect(result[1]!.text).toContain('content');
  });

  it('detects default value change', () => {
    const oldWithDefault: PropertySummary = { ...old, default: 'a' };
    const result = diffProperty('x', oldWithDefault, {
      $type: 'Boolean',
      $category: 'design',
      $required: false,
      $default: 'b',
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toContain('default="a"');
    expect(result[1]!.text).toContain('default="b"');
  });

  it('type comparison is case-insensitive', () => {
    const result = diffProperty('flag', old, { $type: 'boolean', $category: 'design', $required: false });
    expect(result).toEqual([]);
  });

  it('skips type comparison when old type is empty', () => {
    const oldEmpty: PropertySummary = { type: '', category: 'design', required: false };
    const result = diffProperty('x', oldEmpty, { $type: 'Symbol', $category: 'design', $required: false });
    expect(result).toEqual([]);
  });

  it('detects type change from Symbol to string (no longer conflated)', () => {
    const result = diffProperty(
      'label',
      { type: 'Symbol', category: 'design', required: false },
      {
        $type: 'string',
        $category: 'design',
        $required: false,
      },
    );
    expect(result).toHaveLength(2);
  });

  it('does not flag String to string as a type change', () => {
    const result = diffProperty(
      'label',
      { type: 'String', category: 'design', required: false },
      {
        $type: 'string',
        $category: 'design',
        $required: false,
      },
    );
    expect(result).toEqual([]);
  });

  it('does not flag Symbol to enum as a type change', () => {
    const result = diffProperty(
      'size',
      { type: 'Symbol', category: 'design', required: false },
      {
        $type: 'enum',
        $category: 'design',
        $required: false,
      },
    );
    expect(result).toEqual([]);
  });

  it('detects type change from Symbol to DTCG.Color', () => {
    const result = diffProperty(
      'color',
      { type: 'Symbol', category: 'design', required: false },
      {
        $type: 'DTCG.Color',
        $category: 'design',
        $required: false,
      },
    );
    expect(result).toHaveLength(2);
  });

  it('does not flag richtext as different from String', () => {
    const result = diffProperty(
      'body',
      { type: 'String', category: 'design', required: false },
      {
        $type: 'richtext',
        $category: 'design',
        $required: false,
      },
    );
    expect(result).toEqual([]);
  });
});

describe('computeComponentDiffLines', () => {
  it('detects added properties', () => {
    const current = makeCurrent({ designProperties: ['existing'] });
    const proposed = {
      $properties: {
        existing: { $type: 'Boolean', $category: 'design' },
        newProp: { $type: 'text', $category: 'content', $required: true },
      },
    };
    const lines = computeComponentDiffLines(current, proposed);
    const added = lines.filter((l) => l.color === 'green');
    expect(added).toHaveLength(1);
    expect(added[0]!.text).toContain('+ newProp');
    expect(added[0]!.text).toContain('text, content, required');
  });

  it('detects removed properties with fullProperties', () => {
    const current = makeCurrent({
      designProperties: ['removed', 'kept'],
      fullProperties: {
        removed: { type: 'Boolean', category: 'design', required: false },
        kept: { type: 'Symbol', category: 'design', required: false },
      },
    });
    const proposed = { $properties: { kept: { $type: 'Symbol', $category: 'design', $required: false } } };
    const lines = computeComponentDiffLines(current, proposed);
    const removed = lines.filter((l) => l.color === 'red');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.text).toBe('- removed: Boolean, design, optional');
  });

  it('detects removed properties without fullProperties (fallback)', () => {
    const current = makeCurrent({ contentProperties: ['title'], designProperties: ['color'] });
    const proposed = { $properties: { title: { $type: 'text', $category: 'content' } } };
    const lines = computeComponentDiffLines(current, proposed);
    const removed = lines.filter((l) => l.color === 'red');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.text).toBe('- color (design)');
  });

  it('detects modified properties using fullProperties', () => {
    const current = makeCurrent({
      designProperties: ['claim'],
      fullProperties: {
        claim: { type: 'Boolean', category: 'design', required: false },
      },
    });
    const proposed = { $properties: { claim: { $type: 'Boolean', $category: 'design', $required: true } } };
    const lines = computeComponentDiffLines(current, proposed);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ color: 'red', text: '- claim: Boolean, design, optional' });
    expect(lines[1]).toMatchObject({ color: 'green', text: '+ claim: Boolean, design, required' });
  });

  it('reports no diff when properties are unchanged', () => {
    const current = makeCurrent({
      designProperties: ['flag'],
      fullProperties: {
        flag: { type: 'Boolean', category: 'design', required: false },
      },
    });
    const proposed = { $properties: { flag: { $type: 'Boolean', $category: 'design', $required: false } } };
    const lines = computeComponentDiffLines(current, proposed);
    expect(lines).toEqual([]);
  });

  it('detects added slots', () => {
    const current = makeCurrent({ slots: ['content'] });
    const proposed = { $properties: {}, $slots: { content: {}, footer: {} } };
    const lines = computeComponentDiffLines(current, proposed);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ color: 'green', text: '+ slot: footer' });
  });

  it('detects removed slots', () => {
    const current = makeCurrent({ slots: ['header', 'content'] });
    const proposed = { $properties: {}, $slots: { content: {} } };
    const lines = computeComponentDiffLines(current, proposed);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ color: 'red', text: '- slot: header' });
  });

  it('falls back to breaking change reasons when fullProperties is absent', () => {
    const current = makeCurrent({ designProperties: ['size'] });
    const proposed = { $properties: { size: { $type: 'number', $category: 'design', $required: true } } };
    const classification = {
      classification: 'breaking' as const,
      breakingChanges: [{ propertyId: 'size', reason: 'type_changed' as const }],
    };
    const lines = computeComponentDiffLines(current, proposed, classification);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ color: 'red', text: '- size: type_changed' });
    expect(lines[1]).toMatchObject({ color: 'green', text: '+ size: number, design, required' });
  });

  it('does not use breaking change fallback when fullProperties is present', () => {
    const current = makeCurrent({
      designProperties: ['size'],
      fullProperties: {
        size: { type: 'Symbol', category: 'design', required: false },
      },
    });
    const proposed = { $properties: { size: { $type: 'number', $category: 'design', $required: true } } };
    const classification = {
      classification: 'breaking' as const,
      breakingChanges: [{ propertyId: 'size', reason: 'type_changed' as const }],
    };
    const lines = computeComponentDiffLines(current, proposed, classification);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toContain('- size: Symbol, design, optional');
    expect(lines[1]!.text).toContain('+ size: number, design, required');
  });

  it('handles multiple changes in one component', () => {
    const current = makeCurrent({
      contentProperties: ['title'],
      designProperties: ['color', 'removed'],
      slots: ['main'],
      fullProperties: {
        title: { type: 'String', category: 'content', required: true },
        color: { type: 'Symbol', category: 'design', required: false },
        removed: { type: 'Boolean', category: 'design', required: false },
      },
    });
    const proposed = {
      $properties: {
        title: { $type: 'text', $category: 'content', $required: false },
        color: { $type: 'Symbol', $category: 'design', $required: false },
        added: { $type: 'number', $category: 'design', $required: false },
      },
      $slots: { main: {}, footer: {} },
    };
    const lines = computeComponentDiffLines(current, proposed);

    const addedProps = lines.filter((l) => l.text.startsWith('+ ') && !l.text.includes('slot'));
    const removedProps = lines.filter((l) => l.text.startsWith('- ') && !l.text.includes('slot'));
    const addedSlots = lines.filter((l) => l.text.includes('+ slot'));
    const removedSlots = lines.filter((l) => l.text.includes('- slot'));

    expect(addedProps.length).toBeGreaterThanOrEqual(2); // added prop + title new
    expect(removedProps.length).toBeGreaterThanOrEqual(2); // removed prop + title old
    expect(addedSlots).toHaveLength(1);
    expect(removedSlots).toHaveLength(0);
    expect(lines.find((l) => l.text.includes('added'))).toBeDefined();
    expect(lines.find((l) => l.text.includes('removed'))).toBeDefined();
  });
});
