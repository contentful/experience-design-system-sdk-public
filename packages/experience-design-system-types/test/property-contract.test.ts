import { describe, expect, it } from 'vitest';
import {
  TARGET_PROPERTY_TYPES,
  SAME_SPACE_RESOURCE_SOURCE,
  type TargetDefinition,
  containsTargetDefinitionType,
  validateTargetValue,
  validateTargetDefinition,
} from '../src/property-contract/target-definition.js';
import { isDateTimeValue } from '../src/property-contract/date-time-value.js';
import {
  jsonEqual,
  cloneJson,
  freezeJson,
  parseStrictJson,
  jsonValueIssue,
} from '../src/property-contract/json-value.js';

describe('TARGET_PROPERTY_TYPES', () => {
  it('contains the 12 target property types (3 primitive + 9 structured)', () => {
    expect(new Set(TARGET_PROPERTY_TYPES)).toEqual(
      new Set([
        'String',
        'Number',
        'Boolean',
        'Array',
        'Record',
        'Integer',
        'DateTime',
        'RichText',
        'JSON',
        'ResourceLink',
        'Literal',
        'DiscriminatedUnion',
      ]),
    );
  });
});

describe('validateTargetValue — primitives', () => {
  it('accepts a valid String value', () => {
    expect(validateTargetValue({ type: 'String' }, 'hello')).toEqual([]);
  });
  it('rejects a non-string for String', () => {
    expect(validateTargetValue({ type: 'String' }, 42)).toHaveLength(1);
  });
  it('accepts a finite Number', () => {
    expect(validateTargetValue({ type: 'Number' }, 3.14)).toEqual([]);
  });
  it('rejects NaN/Infinity for Number', () => {
    expect(validateTargetValue({ type: 'Number' }, Number.NaN as unknown as number)).toHaveLength(1);
  });
  it('accepts a safe Integer', () => {
    expect(validateTargetValue({ type: 'Integer' }, 42)).toEqual([]);
  });
  it('rejects a non-integer Number for Integer', () => {
    expect(validateTargetValue({ type: 'Integer' }, 3.14)).toHaveLength(1);
  });
  it('accepts a Boolean', () => {
    expect(validateTargetValue({ type: 'Boolean' }, true)).toEqual([]);
  });
  it('accepts an ISO DateTime with timezone', () => {
    expect(validateTargetValue({ type: 'DateTime' }, '2026-10-27T18:00:00Z')).toEqual([]);
  });
  it('rejects a plain date string for DateTime', () => {
    expect(validateTargetValue({ type: 'DateTime' }, '2026-10-27')).toHaveLength(1);
  });
});

describe('validateTargetValue — containers', () => {
  it('accepts a valid Array of items', () => {
    const def: TargetDefinition = { type: 'Array', items: { type: 'String' } };
    expect(validateTargetValue(def, ['a', 'b'])).toEqual([]);
  });
  it('rejects a non-array for Array', () => {
    const def: TargetDefinition = { type: 'Array', items: { type: 'String' } };
    expect(validateTargetValue(def, 'nope' as never)).toHaveLength(1);
  });
  it('reports per-item issues for Array', () => {
    const def: TargetDefinition = { type: 'Array', items: { type: 'String' } };
    const issues = validateTargetValue(def, ['ok', 42 as never, 'fine']);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toContain('1');
  });

  it('accepts a Record with all required fields', () => {
    const def: TargetDefinition = {
      type: 'Record',
      fields: {
        title: { type: 'String', required: true },
        count: { type: 'Integer' },
      },
    };
    expect(validateTargetValue(def, { title: 'Hi', count: 3 })).toEqual([]);
  });
  it('flags unknown field keys on a Record', () => {
    const def: TargetDefinition = {
      type: 'Record',
      fields: { title: { type: 'String', required: true } },
    };
    const issues = validateTargetValue(def, { title: 'Hi', extra: 'nope' });
    expect(issues.some((i) => i.message === 'Unknown field')).toBe(true);
  });
  it('flags missing required field on a Record', () => {
    const def: TargetDefinition = {
      type: 'Record',
      fields: { title: { type: 'String', required: true } },
    };
    const issues = validateTargetValue(def, {});
    expect(issues.some((i) => i.message === 'Required field missing')).toBe(true);
  });
});

describe('validateTargetDefinition — definition shape', () => {
  it('accepts a minimal valid String definition', () => {
    expect(validateTargetDefinition({ type: 'String' }).valid).toBe(true);
  });
  it('rejects an unknown target type', () => {
    const result = validateTargetDefinition({ type: 'Mystery' });
    expect(result.valid).toBe(false);
  });
  it('rejects an Array definition without items', () => {
    const result = validateTargetDefinition({ type: 'Array' });
    expect(result.valid).toBe(false);
  });
  it('rejects a Record definition with empty fields dictionary', () => {
    const result = validateTargetDefinition({ type: 'Record', fields: {} });
    expect(result.valid).toBe(false);
  });
  it('rejects a ResourceLink without allowedResources', () => {
    const result = validateTargetDefinition({ type: 'ResourceLink' });
    expect(result.valid).toBe(false);
  });
  it('accepts a ResourceLink referencing Entry types in the same space', () => {
    const result = validateTargetDefinition({
      type: 'ResourceLink',
      allowedResources: [{ type: 'Contentful:Entry', source: SAME_SPACE_RESOURCE_SOURCE, allowedTypes: ['card'] }],
    });
    expect(result.valid).toBe(true);
  });
});

describe('containsTargetDefinitionType — traversal', () => {
  it('finds a nested type inside an Array', () => {
    const def: TargetDefinition = { type: 'Array', items: { type: 'DateTime' } };
    expect(containsTargetDefinitionType(def, 'DateTime')).toBe(true);
    expect(containsTargetDefinitionType(def, 'Boolean')).toBe(false);
  });
  it('finds a nested type inside a Record field', () => {
    const def: TargetDefinition = {
      type: 'Record',
      fields: { published: { type: 'DateTime' }, title: { type: 'String' } },
    };
    expect(containsTargetDefinitionType(def, 'DateTime')).toBe(true);
  });
});

describe('isDateTimeValue', () => {
  it('accepts a UTC ISO datetime', () => {
    expect(isDateTimeValue('2026-10-27T18:00:00Z')).toBe(true);
  });
  it('rejects a non-string', () => {
    expect(isDateTimeValue(42)).toBe(false);
  });
  it('rejects a date-only string', () => {
    expect(isDateTimeValue('2026-10-27')).toBe(false);
  });
});

describe('json-value helpers', () => {
  it('jsonEqual compares deeply by value', () => {
    expect(jsonEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
  it('cloneJson produces a deep independent copy', () => {
    const src = { a: { b: 1 } };
    const copy = cloneJson(src);
    (copy as { a: { b: number } }).a.b = 99;
    expect(src.a.b).toBe(1);
  });
  it('freezeJson deeply freezes a structure', () => {
    const frozen = freezeJson({ a: { b: 1 } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
  });
  it('parseStrictJson rejects duplicate keys', () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow();
  });
  it('jsonValueIssue flags non-JSON values', () => {
    const issue = jsonValueIssue(undefined);
    expect(issue).toBeDefined();
  });
});
