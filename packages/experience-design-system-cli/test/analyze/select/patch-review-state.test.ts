import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import { patchReviewStateWithValidationErrors } from '../../../src/analyze/select/command.js';
import type { ReviewSessionSnapshot } from '../../../src/analyze/select/types.js';

describe('patchReviewStateWithValidationErrors', () => {
  let tmpDir: string;
  let prevDbPath: string | undefined;
  let prevArtifactsRoot: string | undefined;
  let artifactsRoot: string;
  let goodSrc: string;
  let badSrc: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-patch-'));
    prevDbPath = process.env.EDS_PIPELINE_DB_PATH;
    prevArtifactsRoot = process.env.EDS_REVIEW_ARTIFACTS_DIR;
    process.env.EDS_PIPELINE_DB_PATH = join(tmpDir, 'pipeline.db');
    artifactsRoot = join(tmpDir, 'reviews');
    process.env.EDS_REVIEW_ARTIFACTS_DIR = artifactsRoot;
    goodSrc = join(tmpDir, 'PageLink.tsx');
    badSrc = join(tmpDir, 'Button.tsx');
    await writeFile(goodSrc, '// PageLink\n');
    await writeFile(badSrc, '// Button\n');
  });

  afterEach(async () => {
    if (prevDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = prevDbPath;
    if (prevArtifactsRoot === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = prevArtifactsRoot;
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
        name: 'PageLink',
        source: goodSrc,
        framework: 'react',
        props: [],
        slots: [{ name: 'children', isDefault: true }],
      },
      {
        name: 'Button',
        source: badSrc,
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ]);
    db.close();
    return sessionId;
  }

  async function readState(sessionId: string): Promise<ReviewSessionSnapshot> {
    const path = resolve(artifactsRoot, sessionId, 'current-review-state.json');
    return JSON.parse(await readFile(path, 'utf8')) as ReviewSessionSnapshot;
  }

  it('creates the state file on first call when none exists, then patches', async () => {
    const sessionId = await seedSession();

    const result = await patchReviewStateWithValidationErrors(sessionId, [
      {
        componentName: 'PageLink',
        path: 'manifest:components/PageLink/$slots/',
        message: 'Slot id must be a non-empty string',
      },
    ]);

    expect(result).toEqual({ patchedNames: ['PageLink'], missingNames: [] });

    const state = await readState(sessionId);
    const pageLink = state.components.find((c) => c.name === 'PageLink')!;
    expect(pageLink.originalProposal.validationIssues).toEqual([
      {
        severity: 'error',
        code: 'SERVER_VALIDATION_FAILED',
        message: 'Slot id must be a non-empty string',
      },
    ]);
  });

  it('patches an existing state file (preserves prior fields) and appends issues', async () => {
    const sessionId = await seedSession();

    // First call seeds the state file from the DB.
    await patchReviewStateWithValidationErrors(sessionId, []);
    const before = await readState(sessionId);
    expect(before.components.length).toBe(2);

    const result = await patchReviewStateWithValidationErrors(sessionId, [
      { componentName: 'Button', path: 'manifest:components/Button/$properties/variant', message: 'variant required' },
    ]);

    expect(result.patchedNames).toEqual(['Button']);

    const after = await readState(sessionId);
    const button = after.components.find((c) => c.name === 'Button')!;
    expect(button.originalProposal.validationIssues).toEqual([
      { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'variant required' },
    ]);
    // Untouched component is preserved.
    expect(after.components.find((c) => c.name === 'PageLink')).toBeDefined();
  });

  it('appends multiple issues for one component when multiple errors target it', async () => {
    const sessionId = await seedSession();

    await patchReviewStateWithValidationErrors(sessionId, [
      {
        componentName: 'PageLink',
        path: 'manifest:components/PageLink/$slots/',
        message: 'Slot id must be a non-empty string',
      },
      { componentName: 'PageLink', path: 'manifest:components/PageLink/$slots/foo', message: 'Slot value invalid' },
    ]);

    const state = await readState(sessionId);
    const pageLink = state.components.find((c) => c.name === 'PageLink')!;
    expect(pageLink.originalProposal.validationIssues?.length).toBe(2);
    expect(pageLink.originalProposal.validationIssues?.map((i) => i.message)).toEqual([
      'Slot id must be a non-empty string',
      'Slot value invalid',
    ]);
  });

  it('returns missing names for components not in the snapshot, without throwing', async () => {
    const sessionId = await seedSession();

    const result = await patchReviewStateWithValidationErrors(sessionId, [
      { componentName: 'PageLink', path: 'manifest:components/PageLink/$slots/', message: 'real' },
      { componentName: 'NotThere', path: 'manifest:components/NotThere/$slots/', message: 'ghost' },
    ]);

    expect(result.patchedNames).toEqual(['PageLink']);
    expect(result.missingNames).toEqual(['NotThere']);
  });

  it('preserves existing validationIssues from the prior state and appends', async () => {
    const sessionId = await seedSession();

    // Seed a state file that already has a prior validationIssue on Button.
    const initialState: ReviewSessionSnapshot = {
      components: [
        {
          id: 'pagelink-id',
          name: 'PageLink',
          resolvedSourcePath: goodSrc,
          sourceCode: null,
          originalProposal: {
            name: 'PageLink',
            source: goodSrc,
            framework: 'react',
            props: [],
            slots: [{ name: 'children', isDefault: true }],
          },
          editedProposal: {
            name: 'PageLink',
            source: goodSrc,
            framework: 'react',
            props: [],
            slots: [{ name: 'children', isDefault: true }],
          },
          status: 'needs-review',
        },
        {
          id: 'button-id',
          name: 'Button',
          resolvedSourcePath: badSrc,
          sourceCode: null,
          originalProposal: {
            name: 'Button',
            source: badSrc,
            framework: 'react',
            props: [{ name: 'variant', type: 'string', required: false }],
            slots: [],
            validationIssues: [{ severity: 'warning', code: 'EMPTY_PROP_NAME', message: 'pre-existing warning' }],
          },
          editedProposal: {
            name: 'Button',
            source: badSrc,
            framework: 'react',
            props: [{ name: 'variant', type: 'string', required: false }],
            slots: [],
          },
          status: 'needs-review',
        },
      ],
    };
    const sessionDir = join(artifactsRoot, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'current-review-state.json'), JSON.stringify(initialState));

    await patchReviewStateWithValidationErrors(sessionId, [
      { componentName: 'Button', path: 'manifest:components/Button/$properties/variant', message: 'variant required' },
    ]);

    const after = await readState(sessionId);
    const button = after.components.find((c) => c.name === 'Button')!;
    expect(button.originalProposal.validationIssues).toEqual([
      { severity: 'warning', code: 'EMPTY_PROP_NAME', message: 'pre-existing warning' },
      { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'variant required' },
    ]);
  });

  it('is a no-op when errors is empty (still ensures state file exists)', async () => {
    const sessionId = await seedSession();
    const result = await patchReviewStateWithValidationErrors(sessionId, []);
    expect(result).toEqual({ patchedNames: [], missingNames: [] });

    const state = await readState(sessionId);
    expect(state.components.length).toBe(2);
    for (const c of state.components) {
      expect(c.originalProposal.validationIssues ?? []).toEqual([]);
    }
  });
});
