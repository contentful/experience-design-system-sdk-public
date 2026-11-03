import { describe, expect, it } from 'vitest';
import {
  SourceInputAssociationSchema,
  sourceInputOwnerKey,
  validateSourceInputOwners,
  validateCDFSourceOwnerContract,
  type SourceInputAssociation,
} from '../src/source-input-association.js';

const associationFor = (name: string, path: string[] = [name]): SourceInputAssociation => ({
  schemaVersion: 1,
  componentId: 'cid-1',
  componentDeclarationId: 'cdid-1',
  rootSymbolId: 'rsid-1',
  inputName: name,
  inputPath: path,
});

describe('SourceInputAssociationSchema', () => {
  it('accepts a well-formed association', () => {
    expect(SourceInputAssociationSchema.safeParse(associationFor('title')).success).toBe(true);
  });

  it('rejects an association where inputPath[0] does not match inputName', () => {
    expect(SourceInputAssociationSchema.safeParse({ ...associationFor('title'), inputPath: ['other'] }).success).toBe(
      false,
    );
  });

  it('rejects a blank inputName', () => {
    expect(SourceInputAssociationSchema.safeParse(associationFor('', [''])).success).toBe(false);
  });

  it('rejects an empty inputPath', () => {
    expect(SourceInputAssociationSchema.safeParse({ ...associationFor('title'), inputPath: [] }).success).toBe(false);
  });

  it('rejects a non-literal schemaVersion', () => {
    expect(
      SourceInputAssociationSchema.safeParse({ ...associationFor('title'), schemaVersion: 2 as unknown as 1 }).success,
    ).toBe(false);
  });
});

describe('sourceInputOwnerKey', () => {
  it('produces a stable key for the owning identity', () => {
    const a = associationFor('title');
    const b = associationFor('title');
    expect(sourceInputOwnerKey(a)).toBe(sourceInputOwnerKey(b));
  });

  it('produces distinct keys when the input path differs', () => {
    const a = associationFor('title', ['title']);
    const b = associationFor('title', ['title', 'inner']);
    expect(sourceInputOwnerKey(a)).not.toBe(sourceInputOwnerKey(b));
  });
});

describe('validateSourceInputOwners', () => {
  it('accepts unique names with distinct source inputs', () => {
    expect(() =>
      validateSourceInputOwners([
        { name: 'title', sourceInput: associationFor('title') },
        { name: 'subtitle', sourceInput: associationFor('subtitle') },
      ]),
    ).not.toThrow();
  });

  it('throws on duplicate authoring names', () => {
    expect(() =>
      validateSourceInputOwners([
        { name: 'title', sourceInput: associationFor('title') },
        { name: 'title', sourceInput: associationFor('subtitle') },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('throws on blank authoring names', () => {
    expect(() => validateSourceInputOwners([{ name: '  ', sourceInput: associationFor('title') }])).toThrow(/blank/i);
  });

  it('throws when two owners share the same source input', () => {
    expect(() =>
      validateSourceInputOwners([
        { name: 'title', sourceInput: associationFor('title') },
        { name: 'headline', sourceInput: associationFor('title') },
      ]),
    ).toThrow(/multiple owners/i);
  });

  it('throws on an invalid source input shape', () => {
    expect(() =>
      validateSourceInputOwners([{ name: 'title', sourceInput: { ...associationFor('title'), inputPath: [] } }]),
    ).toThrow(/invalid/i);
  });
});

describe('validateCDFSourceOwnerContract', () => {
  it('accepts a CDF entry with disjoint property/slot ownership', () => {
    expect(() =>
      validateCDFSourceOwnerContract({
        $properties: { title: { $sourceInput: associationFor('title') } },
        $slots: { children: { $sourceInput: associationFor('children') } },
      }),
    ).not.toThrow();
  });

  it('throws when a property and a slot both own the same inputName without a $sourceInput on the property', () => {
    expect(() =>
      validateCDFSourceOwnerContract({
        $properties: { items: {} },
        $slots: { items: { $sourceInput: associationFor('items') } },
      }),
    ).toThrow(/conflict/i);
  });

  it('throws on a blank slot name', () => {
    expect(() =>
      validateCDFSourceOwnerContract({
        $properties: {},
        $slots: { '  ': {} },
      }),
    ).toThrow(/blank slot/i);
  });
});
