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

export async function enterProjectPath(app: ImportSession, path: string): Promise<void> {
  await app.waitForText('Project path');
  await app.type(path);
  await app.press('enter');
}

/** The scan result: the import shows what it found and the user confirms. */
export async function confirmScan(app: ImportSession): Promise<void> {
  await app.waitForText('Does this look right?');
  await app.press('enter');
}

/** The scope gate lists what extraction found; the user accepts everything and continues. */
export async function acceptEverythingInScopeGate(app: ImportSession, count: number): Promise<void> {
  await app.waitForText(`Undecided ${count}`);
  await app.type('A');
  await app.waitForText(`Accepted ${count}/${count}`);
  await app.type('f');
}

/** The review of what was generated: accept everything, finalize and confirm. */
export async function acceptEverythingInReview(app: ImportSession): Promise<void> {
  await app.waitForText('FIELD EDITOR');
  await app.type('A');
  await app.type('f');
  await app.waitForText('Save decisions and exit?');
  await app.press('enter');
}

/** Where to save the files (the default is fine), then the preview of what will be created, then the push. */
export async function saveAndPush(app: ImportSession): Promise<void> {
  await app.waitForText('Save to:');
  await app.press('enter');
  await app.waitForText('[Enter] Push to Contentful');
  await app.press('enter');
}
