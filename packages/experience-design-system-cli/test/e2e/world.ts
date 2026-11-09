import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A scenario's temp folders: a copy of the fixture project, an output folder, and a private config home and pipeline
// database, so nothing touches the real `.contentful` folder or settings.

const FIXTURE_PROJECT = fileURLToPath(new URL('./fixtures/project', import.meta.url));
const ENV_KEYS = ['EDS_HOME', 'EDS_PIPELINE_DB_PATH'] as const;

export interface ImportWorld {
  projectDir: string;
  /** The design tokens file inside the project copy. */
  tokensFile: string;
  /** Where the import writes its files; the CDF ends up here. */
  outDir: string;
  /** Puts the environment back and deletes every folder. */
  remove(): Promise<void>;
}

export async function createWorld(): Promise<ImportWorld> {
  const root = await mkdtemp(join(tmpdir(), 'e2e-import-'));
  const projectDir = join(root, 'project');
  const outDir = join(root, 'out');
  const home = join(root, 'home');
  await cp(FIXTURE_PROJECT, projectDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'config.json'), JSON.stringify({ contentfulBaseDir: outDir }));

  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env['EDS_HOME'] = home;
  process.env['EDS_PIPELINE_DB_PATH'] = join(root, 'pipeline.db');

  return {
    projectDir,
    tokensFile: join(projectDir, 'lib', 'design-tokens.ts'),
    outDir,
    remove: async () => {
      for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
