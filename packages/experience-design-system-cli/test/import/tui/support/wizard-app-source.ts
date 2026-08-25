import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const wizardAppPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../src/import/tui/WizardApp.tsx');

/** Reads WizardApp.tsx source for source-level regression pins. */
export function readWizardAppSource(): Promise<string> {
  return readFile(wizardAppPath, 'utf8');
}
