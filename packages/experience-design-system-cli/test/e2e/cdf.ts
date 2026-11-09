import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { validateCDFFile, validateDTCGTokenFile } from '@contentful/experience-design-system-backend-pipeline';

// What a happy path checks on disk: the files the import saved are legit, by the same validators the CLI ships.

async function findSaved(outDir: string, name: string): Promise<string> {
  const files = (await readdir(outDir, { recursive: true })).filter(
    (file) => file.endsWith(`/${name}`) && !file.includes('/debug/'),
  );
  expect(files, `${name} should have been saved under ${outDir}`).toHaveLength(1);
  return join(outDir, files[0]!);
}

/** The CDF document (`components.json`, which also carries the tokens) is valid against the CDF schema. */
export async function expectValidCdf(outDir: string): Promise<void> {
  const result = await validateCDFFile(await findSaved(outDir, 'components.json'));
  expect(result.valid, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
}

/** The generated tokens file (`tokens.json`) is valid DTCG. */
export async function expectValidTokens(outDir: string): Promise<void> {
  const result = await validateDTCGTokenFile(await findSaved(outDir, 'tokens.json'));
  expect(result.valid, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
}
