import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

export type DsiConfiguration = {
  space_id: string;
  env_id: string;
  cma_token: string;
  api_endpoint: string;
};

const EMPTY_CONFIGURATION: DsiConfiguration = {
  space_id: '',
  env_id: '',
  cma_token: '',
  api_endpoint: '',
};

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === PACKAGE_NAME) return dir;
    } catch {
      // No readable manifest here; keep walking.
    }

    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

export function dsiConfigurationPath(): string {
  return join(findPackageRoot(), '.contentful', 'config', 'dsi_configuration.json');
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
