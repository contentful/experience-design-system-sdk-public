import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setEnv } from './env.js';

// A scenario's temp folders: a copy of the fixture project, an output folder, and a private config home and pipeline
// database, so nothing touches the real `.contentful` folder or settings. Usage analytics is switched off with
// DISABLE_ANALYTICS: it is on by default, and the harness enters the app below the code that reads the saved preference.

const FIXTURE_PROJECT = fileURLToPath(new URL('./fixtures/project', import.meta.url));

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

  const restoreEnv = setEnv({
    EDS_HOME: home,
    EDS_PIPELINE_DB_PATH: join(root, 'pipeline.db'),
    DISABLE_ANALYTICS: '1',
  });

  return {
    projectDir,
    tokensFile: join(projectDir, 'lib', 'design-tokens.ts'),
    outDir,
    remove: async () => {
      restoreEnv();
      await rm(root, { recursive: true, force: true });
    },
  };
}
