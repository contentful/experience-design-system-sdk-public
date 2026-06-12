import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPipelineDb, storeRawComponents, loadRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import { loadReviewInput } from '../../../src/analyze/select/parser.js';
import { validateExtractedComponents } from '../../../src/analyze/extract/validate.js';

describe('analyze select cold-start re-validation', () => {
  let tmpDir: string;
  let prevDbPath: string | undefined;
  let sourceFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-cold-start-'));
    prevDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(tmpDir, 'pipeline.db');
    sourceFilePath = join(tmpDir, 'BadComponent.tsx');
    await writeFile(sourceFilePath, '// fixture\n');
  });

  afterEach(async () => {
    if (prevDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = prevDbPath;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('persistence drops validationIssues but the validator can recompute them', async () => {
    const db = openPipelineDb();
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    storeRawComponents(db, sessionId, [
      {
        name: 'BadComponent',
        source: sourceFilePath,
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
    ]);

    const reloaded = loadRawComponents(db, sessionId);
    db.close();

    expect(reloaded[0].validationIssues).toBeUndefined();

    const validated = validateExtractedComponents(reloaded);
    expect(validated[0].validationIssues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'EMPTY_SLOT_NAME' }),
    );
  });

  it('loadReviewInput preserves validationIssues set on the input components', async () => {
    const db = openPipelineDb();
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    storeRawComponents(db, sessionId, [
      {
        name: 'BadComponent',
        source: sourceFilePath,
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
    ]);

    const reloaded = loadRawComponents(db, sessionId);
    db.close();

    const validated = validateExtractedComponents(reloaded);
    const snapshot = await loadReviewInput(validated, { reviewRoot: tmpDir });

    expect(snapshot.components[0].originalProposal.validationIssues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'EMPTY_SLOT_NAME' }),
    );
  });
});

describe('loadAndValidateForReview helper (used by analyze select)', () => {
  let tmpDir: string;
  let prevDbPath: string | undefined;
  let sourceFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-cold-start-helper-'));
    prevDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(tmpDir, 'pipeline.db');
    sourceFilePath = join(tmpDir, 'BadComponent.tsx');
    await writeFile(sourceFilePath, '// fixture\n');
  });

  afterEach(async () => {
    if (prevDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = prevDbPath;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('attaches validationIssues to the snapshot even when DB persistence dropped them', async () => {
    const { loadAndValidateForReview } = await import('../../../src/analyze/select/command.js');

    const db = openPipelineDb();
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    storeRawComponents(db, sessionId, [
      {
        name: 'BadComponent',
        source: sourceFilePath,
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
    ]);
    db.close();

    const snapshot = await loadAndValidateForReview(sessionId, tmpDir);

    expect(snapshot.components[0].originalProposal.validationIssues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'EMPTY_SLOT_NAME' }),
    );
  });
});
