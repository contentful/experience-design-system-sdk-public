import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readExperiencesCredentials } from '../src/credentials/services/read-credentials.js';
import { loadAcceptedNames } from '../src/review-session/repositories/load-accepted-names.js';
import { ensureRefineSession } from '../src/review-session/repositories/ensure-review-session.js';
import { getRefineSessionPaths } from '../src/review-session/repositories/review-session-paths.js';
import { readSettings, updateSettings } from '../src/session/helpers/config-root.js';
import { mergePreviewValidationErrorsIntoReviewSession } from '../../steps/selection/src/controller/review/merge-preview-validation-errors-into-review-session.js';
import { runGenerateComponentsSession } from '../../orchestrators/run-generate-components-session/run-generate-components-session.js';
import { openPipelineDb, getOrCreateSession, storeRawComponents } from '../src/session/repositories/db.js';

vi.mock('../../analytics/index.js', () => ({ bindAnalyticsSessionId: async () => {} }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({ invoke }),
}));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-integrity-'));
  vi.stubEnv('EDS_HOME', root);
  vi.stubEnv('EDS_REVIEW_ARTIFACTS_DIR', join(root, 'reviews'));
  vi.stubEnv('EDS_PIPELINE_DB_PATH', join(root, 'pipeline.db'));
  invoke.mockReset();
  invoke.mockResolvedValue({
    stdout: JSON.stringify({
      tool: 'classify_prop',
      component: 'Panel',
      prop: 'label',
      cdf_type: 'string',
      cdf_category: 'content',
    }),
    stderr: '',
    exitCode: 0,
    timedOut: false,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it('distinguishes missing, accepted subset and explicit empty review filters', async () => {
  expect(await loadAcceptedNames('example')).toBeNull();
  const paths = await getRefineSessionPaths('example', join(root, 'reviews'));
  mkdirSync(paths.sessionDir, { recursive: true });
  writeFileSync(
    paths.statePath,
    JSON.stringify({
      components: [
        { name: 'Panel', status: 'accepted' },
        { name: 'Other', status: 'rejected' },
      ],
    }),
  );
  expect(await loadAcceptedNames('example')).toEqual(new Set(['Panel']));
  writeFileSync(paths.statePath, JSON.stringify({ components: [] }));
  expect(await loadAcceptedNames('example')).toEqual(new Set());
});
it.each(['malformed', 'directory'])('raises with review path for %s filter reads', async (kind) => {
  const paths = await getRefineSessionPaths('example', join(root, 'reviews'));
  mkdirSync(paths.sessionDir, { recursive: true });
  if (kind === 'directory') mkdirSync(paths.statePath);
  else writeFileSync(paths.statePath, '{ broken');
  await expect(loadAcceptedNames('example')).rejects.toThrow(paths.statePath);
});
it('preserves corrupt state and existing events during ensure/resume and preview recovery', async () => {
  const paths = await getRefineSessionPaths('example', join(root, 'reviews'));
  mkdirSync(paths.sessionDir, { recursive: true });
  writeFileSync(paths.statePath, '{ retained broken source observations');
  writeFileSync(paths.eventsPath, 'retained events\n');
  await expect(ensureRefineSession('example', join(root, 'reviews'), { components: [] })).rejects.toThrow(
    paths.statePath,
  );
  await expect(
    mergePreviewValidationErrorsIntoReviewSession('example', [], { artifactsRoot: join(root, 'reviews') }),
  ).rejects.toThrow(paths.statePath);
  expect(readFileSync(paths.statePath, 'utf8')).toBe('{ retained broken source observations');
  expect(readFileSync(paths.eventsPath, 'utf8')).toBe('retained events\n');
});
it('blocks actual generation on corrupt review and keeps valid empty generation empty', async () => {
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Panel',
      source: '/example/Panel.tsx',
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [],
    },
  ]);
  db.close();
  const paths = await getRefineSessionPaths(sessionId, join(root, 'reviews'));
  mkdirSync(paths.sessionDir, { recursive: true });
  writeFileSync(paths.statePath, '{ broken');
  const request = {
    sessionId,
    agent: 'codex',
    noCache: true,
    promptOverrides: ['generate=text:Classify supplied source.'],
  };
  await expect(runGenerateComponentsSession(request)).rejects.toThrow(paths.statePath);
  expect(invoke).not.toHaveBeenCalled();
  writeFileSync(paths.statePath, JSON.stringify({ components: [] }));
  const result = await runGenerateComponentsSession(request);
  expect(result.emptySession).toBe(true);
  expect(result.results).toEqual([]);
  expect(invoke).not.toHaveBeenCalled();
});
it.each(['malformed', 'directory'])('backend settings reject %s reads before merge', async (kind) => {
  const path = join(root, 'config.json');
  if (kind === 'directory') mkdirSync(path);
  else writeFileSync(path, '{ retained broken settings');
  await expect(readSettings()).rejects.toThrow(path);
  await expect(updateSettings({ debug: true })).rejects.toThrow(path);
  if (kind === 'malformed') expect(readFileSync(path, 'utf8')).toBe('{ retained broken settings');
});

it('warns on damaged settings while preserving the credential environment fallback', async () => {
  writeFileSync(join(root, 'config.json'), '{ retained broken');
  vi.stubEnv('CONTENTFUL_SPACE_ID', 'example-space');
  vi.stubEnv('CONTENTFUL_MANAGEMENT_TOKEN', 'example-token');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await readExperiencesCredentials()).toMatchObject({ spaceId: 'example-space', cmaToken: 'example-token' });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(join(root, 'config.json')));
    expect(warning.mock.calls.flat().join(' ')).not.toContain('example-token');
  } finally {
    warning.mockRestore();
  }
});

it('initializes missing review once and transports snapshot fields and valid preview issues', async () => {
  const snapshot = {
    marker: {
      source: 'retained',
      facts: ['example-fact'],
      candidates: ['example-candidate'],
      provenance: 'example-provenance',
    },
    components: [
      {
        name: 'Panel',
        status: 'accepted',
        originalProposal: { validationIssues: [] },
        facts: { source: 'retained' },
        reasons: ['example-reason'],
      },
    ],
  } as never;
  expect(await ensureRefineSession('example', join(root, 'reviews'), snapshot)).toEqual(snapshot);
  const paths = await getRefineSessionPaths('example', join(root, 'reviews'));
  writeFileSync(paths.eventsPath, 'existing events\n');
  expect(await ensureRefineSession('example', join(root, 'reviews'), { components: [] })).toEqual(snapshot);
  const result = await mergePreviewValidationErrorsIntoReviewSession(
    'example',
    [{ componentName: 'Panel', message: 'Example validation issue' } as never],
    { artifactsRoot: join(root, 'reviews') },
  );
  expect(result.patchedNames).toEqual(['Panel']);
  const saved = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  expect(saved.marker).toEqual((snapshot as unknown as { marker: unknown }).marker);
  expect(saved.components[0]).toMatchObject({
    facts: { source: 'retained' },
    reasons: ['example-reason'],
    originalProposal: { validationIssues: [{ code: 'SERVER_VALIDATION_FAILED', message: 'Example validation issue' }] },
  });
  expect(readFileSync(paths.eventsPath, 'utf8')).toBe('existing events\n');
});
it.each(['malformed', 'directory'])('preview recovery independently preserves %s review data', async (kind) => {
  const paths = await getRefineSessionPaths('example', join(root, 'reviews'));
  mkdirSync(paths.sessionDir, { recursive: true });
  if (kind === 'directory') mkdirSync(paths.statePath);
  else writeFileSync(paths.statePath, '{ retained corrupt');
  writeFileSync(paths.eventsPath, 'retained events');
  await expect(
    mergePreviewValidationErrorsIntoReviewSession('example', [], { artifactsRoot: join(root, 'reviews') }),
  ).rejects.toThrow(paths.statePath);
  expect(readFileSync(paths.eventsPath, 'utf8')).toBe('retained events');
  if (kind === 'malformed') expect(readFileSync(paths.statePath, 'utf8')).toBe('{ retained corrupt');
});

it('preserves existing JSON null state and events instead of initializing a missing review', async () => {
  const paths = await getRefineSessionPaths('example', join(root, 'reviews'));
  mkdirSync(paths.sessionDir, { recursive: true });
  writeFileSync(paths.statePath, 'null\n');
  writeFileSync(paths.eventsPath, 'retained events\n');
  const snapshot = await ensureRefineSession('example', join(root, 'reviews'), { components: [] });
  expect(readFileSync(paths.statePath, 'utf8')).toBe('null\n');
  expect(readFileSync(paths.eventsPath, 'utf8')).toBe('retained events\n');
  expect(snapshot).toBeNull();
  await expect(loadAcceptedNames('example')).rejects.toThrow();
  await expect(
    mergePreviewValidationErrorsIntoReviewSession('example', [], { artifactsRoot: join(root, 'reviews') }),
  ).rejects.toThrow();
  expect(readFileSync(paths.statePath, 'utf8')).toBe('null\n');
  expect(readFileSync(paths.eventsPath, 'utf8')).toBe('retained events\n');
});
