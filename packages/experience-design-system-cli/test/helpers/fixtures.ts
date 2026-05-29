import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

export const SAMPLE_COMPONENTS: RawComponentDefinition[] = [
  {
    name: 'Button',
    source: 'src/Button.tsx',
    framework: 'react',
    props: [{ name: 'variant', type: 'string', required: false, defaultValue: '"primary"' }],
    slots: [{ name: 'children', isDefault: true }],
  },
  {
    name: 'Card',
    source: 'src/Card.tsx',
    framework: 'react',
    props: [{ name: 'title', type: 'string', required: true }],
    slots: [{ name: 'children', isDefault: true }],
  },
];

export type TestFixture = {
  dbPath: string;
  dbDir: string;
  projectDir: string;
  sessionId: string;
  cleanup: () => Promise<void>;
};

export async function createTestFixture(components = SAMPLE_COMPONENTS): Promise<TestFixture> {
  const dbDir = await mkdtemp(join(tmpdir(), 'experiences-e2e-db-'));
  const projectDir = await mkdtemp(join(tmpdir(), 'experiences-e2e-proj-'));
  const dbPath = join(dbDir, 'pipeline.db');

  await mkdir(join(projectDir, 'src'), { recursive: true });
  for (const comp of components) {
    await writeFile(join(projectDir, comp.source), `// stub ${comp.name}`, 'utf8');
  }

  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, components);
  db.close();

  return {
    dbPath,
    dbDir,
    projectDir,
    sessionId,
    cleanup: async () => {
      await rm(dbDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    },
  };
}
