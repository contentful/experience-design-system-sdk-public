import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import {
  partitionForExcludeInvalid,
  applySelectAllDecisions,
  loadAndValidateForReview,
} from '../../../src/analyze/select/command.js';

describe('extraction gate helpers (partitionForExcludeInvalid, applySelectAllDecisions)', () => {
  let tmpDir: string;
  let prevDbPath: string | undefined;
  let validSourcePath: string;
  let invalidSourcePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-select-excl-'));
    prevDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(tmpDir, 'pipeline.db');
    validSourcePath = join(tmpDir, 'GoodComponent.tsx');
    invalidSourcePath = join(tmpDir, 'BadComponent.tsx');
    await writeFile(validSourcePath, '// valid\n');
    await writeFile(invalidSourcePath, '// invalid\n');
  });

  afterEach(async () => {
    if (prevDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = prevDbPath;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seedSession(): Promise<string> {
    const db = openPipelineDb();
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    storeRawComponents(db, sessionId, [
      {
        name: 'GoodComponent',
        source: validSourcePath,
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
      {
        name: 'BadComponent',
        source: invalidSourcePath,
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
    ]);
    db.close();
    return sessionId;
  }

  it('partitionForExcludeInvalid splits invalid from valid components', async () => {
    const sessionId = await seedSession();
    const snapshot = await loadAndValidateForReview(sessionId, tmpDir);

    const { invalidNames, validComponents } = partitionForExcludeInvalid(snapshot);

    expect(invalidNames).toEqual(['BadComponent']);
    expect(validComponents.map((c) => c.name)).toEqual(['GoodComponent']);
  });

  it('applySelectAllDecisions always rejects error-severity components and accepts valid', async () => {
    const sessionId = await seedSession();
    const snapshot = await loadAndValidateForReview(sessionId, tmpDir);

    const result = applySelectAllDecisions(snapshot);

    const decisions = Object.fromEntries(result.components.map((c) => [c.name, c.status]));
    expect(decisions['BadComponent']).toBe('rejected');
    expect(decisions['GoodComponent']).toBe('accepted');
  });
});
