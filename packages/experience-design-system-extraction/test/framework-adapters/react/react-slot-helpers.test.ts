import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import {
  isRenderPropType,
  collectRenderPropSlotNames,
  extractSlots,
} from '../../../src/extract/framework-adapters/react/helpers/extract-react-slots.js';

function createProject(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.tsx', code);
  return sf;
}

describe('isRenderPropType', () => {
  it('returns true for a function returning ReactNode', () => {
    const sf = createProject(`
      import { ReactNode } from 'react';
      type T = { renderItem: () => ReactNode };
    `);
    const typeAlias = sf.getTypeAliasOrThrow('T');
    const members = typeAlias.getType().getProperties();
    const renderItem = members.find((p) => p.getName() === 'renderItem')!;
    const decl = renderItem.getValueDeclaration() ?? renderItem.getDeclarations()[0];
    const propType = renderItem.getTypeAtLocation(decl!);
    expect(isRenderPropType(propType)).toBe(true);
  });

  it('returns false for a non-function type', () => {
    const sf = createProject(`
      type T = { label: string };
    `);
    const typeAlias = sf.getTypeAliasOrThrow('T');
    const members = typeAlias.getType().getProperties();
    const label = members.find((p) => p.getName() === 'label')!;
    const decl = label.getValueDeclaration() ?? label.getDeclarations()[0];
    const propType = label.getTypeAtLocation(decl!);
    expect(isRenderPropType(propType)).toBe(false);
  });
});

describe('extractSlots', () => {
  it('includes children slot when hasChildren is true', () => {
    const sf = createProject(`type T = { label: string }`);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const slots = extractSlots(type, true);
    expect(slots.some((s) => s.name === 'children' && s.isDefault)).toBe(true);
  });

  it('does not include children slot when hasChildren is false', () => {
    const sf = createProject(`type T = { label: string }`);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const slots = extractSlots(type, false);
    expect(slots.some((s) => s.name === 'children')).toBe(false);
  });

  it('extracts render prop as a named slot', () => {
    const sf = createProject(`
      import { ReactNode } from 'react';
      type T = { renderHeader: () => ReactNode };
    `);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const slots = extractSlots(type, false);
    expect(slots.some((s) => s.name === 'header' && !s.isDefault)).toBe(true);
  });

  it('returns slots sorted alphabetically', () => {
    const sf = createProject(`
      import { ReactNode } from 'react';
      type T = { renderZebra: () => ReactNode; renderAlpha: () => ReactNode };
    `);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const slots = extractSlots(type, true);
    const names = slots.map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('collectRenderPropSlotNames', () => {
  it('collects names of render props', () => {
    const sf = createProject(`
      import { ReactNode } from 'react';
      type T = { renderHeader: () => ReactNode; label: string };
    `);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const names = collectRenderPropSlotNames(type);
    expect(names.has('renderHeader')).toBe(true);
    expect(names.has('label')).toBe(false);
  });

  it('returns empty set for type with no render props', () => {
    const sf = createProject(`type T = { label: string; disabled: boolean }`);
    const type = sf.getTypeAliasOrThrow('T').getType();
    expect(collectRenderPropSlotNames(type).size).toBe(0);
  });
});
