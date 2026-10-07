import { readSettings, writeSettings } from '@contentful/experience-design-system-types/config';

export type ImportDefaults = {
  componentDir: string;
  tokenFile: string;
};

export async function readImportDefaults(): Promise<ImportDefaults> {
  const { defaultComponentDir, defaultTokenFile } = await readSettings();
  return {
    componentDir: typeof defaultComponentDir === 'string' ? defaultComponentDir : '',
    tokenFile: typeof defaultTokenFile === 'string' ? defaultTokenFile : '',
  };
}

// An empty value clears the default, so the key is removed rather than stored as "".
export async function writeImportDefaults(defaults: ImportDefaults): Promise<void> {
  const current = await readSettings();
  const { defaultComponentDir: _dir, defaultTokenFile: _file, ...rest } = current;
  const componentDir = defaults.componentDir.trim();
  const tokenFile = defaults.tokenFile.trim();
  await writeSettings({
    ...rest,
    ...(componentDir ? { defaultComponentDir: componentDir } : {}),
    ...(tokenFile ? { defaultTokenFile: tokenFile } : {}),
  });
}
