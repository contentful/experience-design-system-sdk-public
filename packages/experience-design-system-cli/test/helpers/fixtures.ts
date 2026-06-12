import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, storeRawComponents, storeScannedFiles, getOrCreateSession } from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

export const SAMPLE_COMPONENTS: RawComponentDefinition[] = [
  {
    name: 'Button',
    source: 'src/Button.tsx',
    framework: 'react',
    props: [
      {
        name: 'variant',
        type: 'string',
        required: false,
        defaultValue: '"primary"',
      },
    ],
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
  addScannedFiles: (absolutePaths: string[]) => void;
  cleanup: () => Promise<void>;
};

export async function createTestFixture(components = SAMPLE_COMPONENTS): Promise<TestFixture> {
  const dbDir = await mkdtemp(join(tmpdir(), 'experiences-e2e-db-'));
  const projectDir = await mkdtemp(join(tmpdir(), 'experiences-e2e-proj-'));
  const dbPath = join(dbDir, 'pipeline.db');

  await mkdir(join(projectDir, 'src'), { recursive: true });
  const componentSourcePaths: string[] = [];
  for (const comp of components) {
    const sourcePath = join(projectDir, comp.source);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `// stub ${comp.name}`, 'utf8');
    componentSourcePaths.push(sourcePath);
  }

  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, {
    command: 'analyze extract',
  });
  storeRawComponents(db, sessionId, components);
  // Store project-relative paths, matching what analyze extract now persists.
  storeScannedFiles(db, sessionId, components.map((c) => c.source));
  db.close();

  return {
    dbPath,
    dbDir,
    projectDir,
    sessionId,
    addScannedFiles: (paths: string[]) => {
      const db2 = openPipelineDb(dbPath);
      try {
        const existing = db2
          .prepare('SELECT path FROM scanned_files WHERE session_id = ?')
          .all(sessionId) as Array<{ path: string }>;
        const relativePaths = paths.map((p) => (isAbsolute(p) ? relative(projectDir, p) : p));
        storeScannedFiles(db2, sessionId, [...existing.map((r) => r.path), ...relativePaths]);
      } finally {
        db2.close();
      }
    },
    cleanup: async () => {
      await rm(dbDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    },
  };
}
