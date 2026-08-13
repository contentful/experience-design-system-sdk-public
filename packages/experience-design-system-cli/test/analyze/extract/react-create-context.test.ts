import { describe, it, expect } from 'vitest';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';
import { useFixtureDir } from './fixture-dir.js';

const { writeFixture } = useFixtureDir('extract-create-context-test-');

describe('extractReactComponents — usesCreateContext flag', () => {
  it('marks components in files that call React.createContext', async () => {
    const filePath = await writeFixture(
      'AbmProvider.tsx',
      `
      import React, { createContext } from 'react';
      type AbmAccount = { id: string };
      const AbmContext = createContext<AbmAccount | null>(null);
      type Props = { value: AbmAccount | null; children: React.ReactNode };
      export function AbmProvider({ value, children }: Props) {
        return <AbmContext.Provider value={value}>{children}</AbmContext.Provider>;
      }
      `,
    );

    const result = await extractReactComponents([filePath]);
    const abm = result.components.find((c) => c.name === 'AbmProvider');
    expect(abm?.usesCreateContext).toBe(true);
  });

  it('does NOT mark components in files without createContext', async () => {
    const filePath = await writeFixture(
      'Accordion.tsx',
      `
      import React from 'react';
      type Props = { title: string; children: React.ReactNode };
      export function Accordion({ title, children }: Props) {
        return <div><h2>{title}</h2>{children}</div>;
      }
      `,
    );

    const result = await extractReactComponents([filePath]);
    const acc = result.components.find((c) => c.name === 'Accordion');
    expect(acc?.usesCreateContext).toBeFalsy();
  });
});
