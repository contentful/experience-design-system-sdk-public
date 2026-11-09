import type { ImportSession } from './harness.js';

// The keystrokes of the screens every import goes through, written as a person would do them.

export type ImportChoice = 'both' | 'tokens' | 'components';

const DOWNS_TO: Record<ImportChoice, number> = { both: 0, tokens: 1, components: 2 };

/** From the home screen: opens Import and picks what to import. */
export async function chooseWhatToImport(app: ImportSession, choice: ImportChoice): Promise<void> {
  await app.waitForText('Import');
  await app.press('enter');
  await app.waitForText('What do you want to import?');
  for (let i = 0; i < DOWNS_TO[choice]; i += 1) await app.press('down');
  await app.press('enter');
}

export async function enterTokenFile(app: ImportSession, path: string): Promise<void> {
  await app.waitForText('Token path');
  await app.type(path);
  await app.press('enter');
}

/** Fills the credentials form (it starts empty, in edit mode) and continues, so the credentials are checked. */
export async function enterCredentials(app: ImportSession, credentials: { host: string }): Promise<void> {
  await app.waitForText('Contentful Credentials');
  await app.type('space1'); // Space ID
  await app.press('down'); // Environment ID keeps its default
  await app.press('down');
  await app.type('e2e-token'); // CMA Token
  await app.press('down');
  await app.press('ctrl-d'); // API Host: replace the default with the fake server
  await app.type(credentials.host);
  await app.press('enter'); // back to the menu, on Continue
  await app.press('enter');
}
