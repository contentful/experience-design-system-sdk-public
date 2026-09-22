import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findPackageRoot } from '../../package-root.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

export type DsiConfiguration = {
  space_id: string;
  env_id: string;
  cma_token: string;
  host: string;
};

export const EMPTY_CONFIGURATION: DsiConfiguration = {
  space_id: '',
  env_id: '',
  cma_token: '',
  host: '',
};

export function dsiConfigurationPath(): string {
  return join(findPackageRoot(import.meta.url, PACKAGE_NAME), '.contentful', 'config', 'dsi_configuration.json');
}

export async function readDsiConfiguration(): Promise<DsiConfiguration> {
  try {
    const raw = await readFile(dsiConfigurationPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DsiConfiguration>;
    return { ...EMPTY_CONFIGURATION, ...parsed };
  } catch {
    return { ...EMPTY_CONFIGURATION };
  }
}

export async function writeDsiConfiguration(config: DsiConfiguration): Promise<void> {
  const path = dsiConfigurationPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
