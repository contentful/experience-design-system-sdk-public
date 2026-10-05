import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureRefineSession, getRefineSessionPaths } from '../../../src/analyze/select/persistence.js';
import { loadReviewInput } from '../../../src/analyze/select/parser.js';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../src/session/db.js';

async function withTempDir<T>(prefix: string, run: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));

  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function makeSession(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  db.close();
  return sessionId;
}

describe('refine persistence', () => {
  it('derives refine artifact paths from the artifacts root using the session ID', async () => {
    await withTempDir('eds-refine-paths-', async (tempDir) => {
      const artifactsRoot = join(tempDir, 'contentful-review-artifacts');
      const sessionId = 'test-session-abc123';

      const paths = await getRefineSessionPaths(sessionId, artifactsRoot);

      expect(paths.sessionDir).toBe(join(artifactsRoot, sessionId));
      expect(paths.eventsPath).toBe(join(artifactsRoot, sessionId, 'events.jsonl'));
      expect(paths.statePath).toBe(join(artifactsRoot, sessionId, 'current-review-state.json'));
    });
  });

  it('uses different session directories for different session IDs', async () => {
    await withTempDir('eds-refine-path-collision-', async (tempDir) => {
      const artifactsRoot = join(tempDir, 'contentful-review-artifacts');

      const firstPaths = await getRefineSessionPaths('session-aaa', artifactsRoot);
      const secondPaths = await getRefineSessionPaths('session-bbb', artifactsRoot);

      expect(firstPaths.sessionDir).not.toBe(secondPaths.sessionDir);
    });
  });

  it('creates the initial session files and resumes from saved state', async () => {
    await withTempDir('eds-refine-session-', async (tempDir) => {
      const artifactsRoot = join(tempDir, 'contentful-review-artifacts');
      const dbPath = join(tempDir, 'pipeline.db');

      const sourcePath = join(tempDir, 'Accordion.jsx');
      await writeFile(sourcePath, 'export function Accordion() { return null; }\n', 'utf8');

      const rawComponents = [
        {
          name: 'Accordion',
          source: sourcePath,
          framework: 'react' as const,
          props: [],
          slots: [],
        },
      ];

      const sessionId = await makeSession(dbPath);
      const db = openPipelineDb(dbPath);
      storeRawComponents(db, sessionId, rawComponents);
      db.close();

      const initialSnapshot = await loadReviewInput(rawComponents, { reviewRoot: tempDir });
      const createdSession = await ensureRefineSession(sessionId, artifactsRoot, initialSnapshot);

      expect(createdSession.components).toHaveLength(1);
      expect(createdSession.components[0]?.originalProposal).toEqual(createdSession.components[0]?.editedProposal);
      expect(createdSession.components[0]?.originalProposal).not.toBe(createdSession.components[0]?.editedProposal);

      const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
      const eventsContents = await readFile(paths.eventsPath, 'utf8');
      const stateContents = JSON.parse(await readFile(paths.statePath, 'utf8')) as {
        components: Array<{ status: string }>;
      };

      expect(eventsContents).toBe('');
      expect(stateContents.components[0]?.status).toBe('needs-review');

      // Simulate the user having reviewed the session
      const updatedState = {
        ...createdSession,
        components: createdSession.components.map((component) => ({
          ...component,
          status: 'reviewed' as const,
        })),
      };
      await writeFile(paths.statePath, JSON.stringify(updatedState, null, 2), 'utf8');

      // Resume should pick up the saved state
      const resumedSession = await ensureRefineSession(sessionId, artifactsRoot, initialSnapshot);
      expect(resumedSession.components[0]?.status).toBe('reviewed');
    });
  });
});
