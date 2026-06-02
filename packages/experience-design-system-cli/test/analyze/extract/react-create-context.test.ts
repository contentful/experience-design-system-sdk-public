import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractReactComponents } from '../../../src/analyze/extract/react.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-create-context-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

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
