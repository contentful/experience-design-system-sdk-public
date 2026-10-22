import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { extractSlots } from '../../../../../../src/steps/extraction/src/framework-adapters/react/helpers/extract-react-slots.js';

function createProject(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.tsx', code);
  return sf;
}

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

  it('does not rename a callable input into a slot', () => {
    const sf = createProject(`
      import { ReactNode } from 'react';
      type T = { renderHeader: () => ReactNode };
    `);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const slots = extractSlots(type, false);
    expect(slots).toEqual([]);
  });

  it('retains the explicit children slot beside callable inputs', () => {
    const sf = createProject(`
      import { ReactNode } from 'react';
      type T = { renderZebra: () => ReactNode; renderAlpha: () => ReactNode };
    `);
    const type = sf.getTypeAliasOrThrow('T').getType();
    const slots = extractSlots(type, true);
    expect(slots).toEqual([{ name: 'children', isDefault: true }]);
  });
});
