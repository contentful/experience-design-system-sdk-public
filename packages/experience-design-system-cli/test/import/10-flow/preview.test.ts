import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getOrCreateSession,
  openPipelineDb,
  storeCDFComponents,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import type { CDFComponentEntry, ServerPreviewResponse } from '@contentful/experience-design-system-types';
import {
  clearedValidationErrorState,
  handlePreview422,
  runPreview,
  type PreviewDeps,
  type RunPreviewInput,
} from '../../../src/tui/import/steps/10-flow/flow/preview.js';

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const raw = (name: string) => ({ name, source: `src/${name}.tsx`, framework: 'react' as const, props: [], slots: [] });

const emptyPreview = (): ServerPreviewResponse => ({
  components: { new: [], changed: [], removed: [], unchanged: [] },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
  taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
});
const withNewComponent = (): ServerPreviewResponse => ({
  ...emptyPreview(),
  components: { new: [{} as never], changed: [], removed: [], unchanged: [] },
});

describe('runPreview', () => {
  let dir: string;
  let previousDbPath: string | undefined;
  let sessionId: string;
  const previewImport = vi.fn();
  const createClient = vi.fn();
  const patchReviewState = vi.fn();
  const readTokens = vi.fn();

  const deps = (overrides: Partial<PreviewDeps> = {}): PreviewDeps => ({
    createClient,
    openDb: openPipelineDb,
    readTokens,
    patchReviewState,
    verboseErrors: false,
    ...overrides,
  });
  const input = (overrides: Partial<RunPreviewInput> = {}): RunPreviewInput => ({
    state: { credentialsSkipped: false },
    extractSessionId: sessionId,
    tokensPath: '',
    spaceId: 'space1',
    environmentId: 'master',
    cmaToken: 'token',
    host: 'https://api.contentful.com',
    deleteAll: false,
    ...overrides,
  });
  const apiError = (status: number, body: unknown) =>
    new ApiError(`preview failed: ${status}`, status, typeof body === 'string' ? body : JSON.stringify(body));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flow-preview-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const db = openPipelineDb();
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(db, sessionId, [raw('Button'), raw('Card')]);
    storeCDFComponents(db, sessionId, [
      { key: 'Button', entry },
      { key: 'Card', entry },
    ]);
    db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
    db.close();
    previewImport.mockReset();
    createClient.mockReset().mockReturnValue({ previewImport });
    patchReviewState.mockReset();
    readTokens.mockReset().mockResolvedValue([]);
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  describe('skipped credentials', () => {
    it('goes straight to done without asking the server, and without building a client', async () => {
      const patch = await runPreview(input({ state: { credentialsSkipped: true } }), deps());

      expect(patch).toEqual({ step: 'done', serverPreview: null });
      expect(createClient).not.toHaveBeenCalled();
      expect(previewImport).not.toHaveBeenCalled();
    });
  });

  describe('a preview with changes', () => {
    it('opens the preview gate with what the server said and the document that was sent', async () => {
      const preview = withNewComponent();
      previewImport.mockResolvedValue(preview);

      const patch = await runPreview(input(), deps());

      expect(patch).toMatchObject({ step: 'preview-gate', serverPreview: preview, finalizeErrorBanner: null });
      const sent = previewImport.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(sent)).toEqual(expect.arrayContaining(['Button', 'Card']));
      expect((patch as { cdf: unknown }).cdf).toBe(sent);
    });

    it('builds the client from the credentials it was given', async () => {
      previewImport.mockResolvedValue(withNewComponent());

      await runPreview(input({ spaceId: 's', environmentId: 'e', cmaToken: 't', host: 'https://h' }), deps());

      expect(createClient).toHaveBeenCalledWith({ cmaToken: 't', spaceId: 's', environmentId: 'e', host: 'https://h' });
    });

    it('clears validation errors left from an earlier attempt', async () => {
      previewImport.mockResolvedValue(withNewComponent());

      expect(await runPreview(input(), deps())).toMatchObject(clearedValidationErrorState());
    });

    it('sends the tokens it read from the tokens file', async () => {
      readTokens.mockResolvedValue([{ path: 'color.brand', $type: 'color', $value: '#06f' }]);
      previewImport.mockResolvedValue(withNewComponent());

      await runPreview(input({ tokensPath: '/t/tokens.json' }), deps());

      expect(readTokens).toHaveBeenCalledWith('/t/tokens.json');
      expect(previewImport.mock.calls[0][0]).toMatchObject({ color: { brand: { $type: 'color', $value: '#06f' } } });
    });

    it('reads no tokens file when there is none', async () => {
      previewImport.mockResolvedValue(withNewComponent());

      await runPreview(input({ tokensPath: '' }), deps());

      expect(readTokens).not.toHaveBeenCalled();
    });

    it('sends an empty but present document when nothing is accepted, so the server shows what would be deleted', async () => {
      const db = openPipelineDb();
      db.prepare(`UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ?`).run(sessionId);
      db.close();
      previewImport.mockResolvedValue({ ...emptyPreview(), components: { ...emptyPreview().components, removed: [] } });

      await runPreview(input({ deleteAll: true }), deps());

      expect(previewImport).toHaveBeenCalledTimes(1);
      expect(Object.keys(previewImport.mock.calls[0][0] as object)).not.toContain('Button');
    });
  });

  describe('a preview with nothing to change', () => {
    it('ends at done with zero counts, instead of the gate or back at the review', async () => {
      previewImport.mockResolvedValue(emptyPreview());

      const patch = await runPreview(input(), deps());

      expect(patch).toMatchObject({
        step: 'done',
        pushResult: {
          componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
        },
      });
    });

    it('is not empty when only tokens would change', async () => {
      previewImport.mockResolvedValue({
        ...emptyPreview(),
        tokens: { new: [{} as never], changed: [], removed: [], unchanged: [] },
      });

      expect(await runPreview(input(), deps())).toMatchObject({ step: 'preview-gate' });
    });
  });

  describe('repairing what the server says would be removed', () => {
    it('re-seeds a rejected component the server still has, and previews again', async () => {
      const db = openPipelineDb();
      const withProp = { ...raw('Card'), props: [{ name: 'label', type: 'string', required: false }] };
      // A component the review rejected is not 'generated', so the backfill leaves its props alone and the preview's
      // answer is the only thing that can classify them.
      storeRawComponents(db, sessionId, [withProp], { status: 'generate-rejected' });
      db.prepare(
        `UPDATE raw_props SET cdf_type = NULL, cdf_category = NULL WHERE session_id = ? AND name = 'label'`,
      ).run(sessionId);
      db.close();
      const removedAtFirst: ServerPreviewResponse = {
        ...emptyPreview(),
        components: {
          new: [],
          changed: [],
          removed: [
            {
              id: 'c1',
              name: 'Card',
              contentProperties: ['label'],
              designProperties: [],
              fullProperties: { label: { type: 'Symbol', category: 'content' } },
            } as never,
          ],
          unchanged: [],
        },
      };
      previewImport.mockResolvedValueOnce(removedAtFirst).mockResolvedValueOnce(withNewComponent());
      const patch = await runPreview(input(), deps());

      expect(previewImport).toHaveBeenCalledTimes(2);
      expect(patch).toMatchObject({ step: 'preview-gate', serverPreview: withNewComponent() });
      const check = openPipelineDb();
      const seeded = check
        .prepare(`SELECT cdf_type FROM raw_props WHERE session_id = ? AND name = 'label'`)
        .get(sessionId) as { cdf_type: string | null };
      check.close();
      expect(seeded.cdf_type).not.toBeNull();
    });

    it('does not preview again when the server wants to remove a local component it knows nothing more about', async () => {
      const removed: ServerPreviewResponse = {
        ...emptyPreview(),
        components: { new: [], changed: [], removed: [{ id: 'c1', name: 'Card' } as never], unchanged: [] },
      };
      previewImport.mockResolvedValue(removed);

      await runPreview(input(), deps());

      expect(previewImport).toHaveBeenCalledTimes(1);
    });

    it('classifies the props of generated components before it asks the server, so they are not sent unclassified', async () => {
      const db = openPipelineDb();
      const withProp = { ...raw('Card'), props: [{ name: 'label', type: 'string', required: false }] };
      storeRawComponents(db, sessionId, [withProp], { status: 'generated' });
      db.prepare(
        `UPDATE raw_props SET cdf_type = NULL, cdf_category = NULL WHERE session_id = ? AND name = 'label'`,
      ).run(sessionId);
      db.close();
      previewImport.mockResolvedValue(withNewComponent());

      await runPreview(input(), deps());

      const check = openPipelineDb();
      const row = check
        .prepare(`SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND name = 'label'`)
        .get(sessionId) as {
        cdf_type: string | null;
        cdf_category: string | null;
      };
      check.close();
      expect(row).toEqual({ cdf_type: 'string', cdf_category: 'content' });
    });

    it('fills in a default the server has and the local component lacks, and previews again', async () => {
      const db = openPipelineDb();
      const withProp = { ...raw('Card'), props: [{ name: 'label', type: 'string', required: false }] };
      storeRawComponents(db, sessionId, [withProp], { status: 'generated' });
      db.prepare(`UPDATE raw_props SET default_value = NULL WHERE session_id = ? AND name = 'label'`).run(sessionId);
      db.close();
      const changed: ServerPreviewResponse = {
        ...emptyPreview(),
        components: {
          new: [],
          changed: [
            {
              current: {
                id: 'c1',
                name: 'Card',
                contentProperties: ['label'],
                designProperties: [],
                fullProperties: { label: { type: 'Symbol', category: 'content', default: 'Hello' } },
              },
              proposed: {},
            } as never,
          ],
          removed: [],
          unchanged: [],
        },
      };
      previewImport.mockResolvedValueOnce(changed).mockResolvedValueOnce(withNewComponent());

      const patch = await runPreview(input(), deps());

      expect(previewImport).toHaveBeenCalledTimes(2);
      expect(patch).toMatchObject({ step: 'preview-gate', serverPreview: withNewComponent() });
      const check = openPipelineDb();
      const row = check
        .prepare(`SELECT default_value FROM raw_props WHERE session_id = ? AND name = 'label'`)
        .get(sessionId) as {
        default_value: string | null;
      };
      check.close();
      expect(row.default_value).toBe('Hello');
    });

    it('does not preview again for a change that gives nothing to fill in', async () => {
      const changed: ServerPreviewResponse = {
        ...emptyPreview(),
        components: {
          new: [],
          changed: [{ current: { id: 'c1', name: 'Card' }, proposed: {} } as never],
          removed: [],
          unchanged: [],
        },
      };
      previewImport.mockResolvedValue(changed);

      await runPreview(input(), deps());

      expect(previewImport).toHaveBeenCalledTimes(1);
    });

    it('does not seed anything for a removal that is not local, even when the server describes it fully', async () => {
      const db = openPipelineDb();
      const withProp = { ...raw('Card'), props: [{ name: 'label', type: 'string', required: false }] };
      storeRawComponents(db, sessionId, [withProp], { status: 'generate-rejected' });
      db.prepare(
        `UPDATE raw_props SET cdf_type = NULL, cdf_category = NULL WHERE session_id = ? AND name = 'label'`,
      ).run(sessionId);
      db.close();
      const removed: ServerPreviewResponse = {
        ...emptyPreview(),
        components: {
          new: [],
          changed: [],
          removed: [
            {
              id: 'x',
              name: 'NotLocal',
              contentProperties: ['label'],
              designProperties: [],
              fullProperties: { label: { type: 'Symbol', category: 'content' } },
            } as never,
          ],
          unchanged: [],
        },
      };
      previewImport.mockResolvedValue(removed);

      await runPreview(input(), deps());

      const check = openPipelineDb();
      const row = check
        .prepare(`SELECT cdf_type FROM raw_props WHERE session_id = ? AND name = 'label'`)
        .get(sessionId) as { cdf_type: string | null };
      check.close();
      expect(row.cdf_type).toBeNull();
      expect(previewImport).toHaveBeenCalledTimes(1);
    });

    it('does not preview again when nothing needed repairing', async () => {
      previewImport.mockResolvedValue(withNewComponent());

      await runPreview(input(), deps());

      expect(previewImport).toHaveBeenCalledTimes(1);
    });

    it('leaves a removal alone when the component is not local, since the server is right about that one', async () => {
      const removed: ServerPreviewResponse = {
        ...emptyPreview(),
        components: {
          new: [],
          changed: [],
          removed: [{ id: 'x', name: 'NotHere', properties: [], slots: [] } as never],
          unchanged: [],
        },
      };
      previewImport.mockResolvedValue(removed);

      const patch = await runPreview(input(), deps());

      expect(previewImport).toHaveBeenCalledTimes(1);
      expect(patch).toMatchObject({ step: 'preview-gate' });
    });

    it('does no repair, and opens no database a second time, without a session', async () => {
      const openDb = vi.fn(openPipelineDb);
      previewImport.mockResolvedValue(withNewComponent());

      await runPreview(input({ extractSessionId: null }), deps({ openDb }));

      expect(openDb).not.toHaveBeenCalled();
      expect(previewImport).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the preview fails', () => {
    it('401 asks for the credentials again', async () => {
      previewImport.mockRejectedValue(apiError(401, { message: 'invalid token' }));

      const patch = await runPreview(input(), deps());

      expect(patch).toMatchObject({ step: 'error', errorStep: 'apply preview' });
      expect((patch as { errorMessage: string }).errorMessage).toContain(
        'Re-run the import and enter credentials again.',
      );
      expect(patch).not.toHaveProperty('errorAllowCredentialRetry');
    });

    it('403 says so in the same way', async () => {
      previewImport.mockRejectedValue(apiError(403, 'forbidden'));

      const patch = await runPreview(input(), deps());

      expect((patch as { errorMessage: string }).errorMessage).toContain(
        'Re-run the import and enter credentials again.',
      );
    });

    it('403 with a "disabled" message from the server shows that message and offers no retry', async () => {
      previewImport.mockRejectedValue(apiError(403, { message: 'Design systems are disabled for this space' }));

      expect(await runPreview(input(), deps())).toEqual({
        step: 'error',
        errorStep: 'apply preview',
        errorMessage: 'Preview failed: Design systems are disabled for this space',
        errorAllowCredentialRetry: false,
      });
    });

    it('404 names the space, environment and host, and offers a retry', async () => {
      previewImport.mockRejectedValue(apiError(404, 'Not found'));

      const patch = (await runPreview(input({ spaceId: 'sp1', environmentId: 'env1', host: 'https://h' }), deps())) as {
        errorMessage: string;
        errorAllowCredentialRetry: boolean;
      };

      expect(patch.errorAllowCredentialRetry).toBe(true);
      expect(patch.errorMessage).toContain('Not found (404).');
      expect(patch.errorMessage).toContain('  Space:       sp1');
      expect(patch.errorMessage).toContain('  Environment: env1');
      expect(patch.errorMessage).toContain('  Host:        https://h');
    });

    it('404 leaves the host line out when there is none', async () => {
      previewImport.mockRejectedValue(apiError(404, 'Not found'));

      expect(((await runPreview(input({ host: '' }), deps())) as { errorMessage: string }).errorMessage).not.toContain(
        'Host:',
      );
    });

    it('422 with component errors opens the validation error step with them', async () => {
      const body = { details: { errors: [{ path: 'manifest:components/Button/properties/x', message: 'bad prop' }] } };
      previewImport.mockRejectedValue(apiError(422, body));
      patchReviewState.mockResolvedValue({ patchedNames: ['Button'], missingNames: ['Ghost'] });

      const patch = await runPreview(input(), deps());

      expect(patch).toMatchObject({ step: 'preview-validation-error', previewValidationMissingNames: ['Ghost'] });
      expect(
        (patch as { previewValidationErrors: Array<{ componentName: string }> }).previewValidationErrors[0]
          .componentName,
      ).toBe('Button');
      expect(patchReviewState).toHaveBeenCalledWith(sessionId, expect.any(Array));
    });

    it('422 without a session does not try to patch the review, and reports no missing names', async () => {
      const body = { details: { errors: [{ path: 'manifest:components/Button/properties/x', message: 'bad prop' }] } };
      previewImport.mockRejectedValue(apiError(422, body));

      const patch = await runPreview(input({ extractSessionId: null }), deps());

      expect(patchReviewState).not.toHaveBeenCalled();
      expect(patch).toMatchObject({ step: 'preview-validation-error', previewValidationMissingNames: [] });
    });

    it('422 whose body names no component falls through to the generic error', async () => {
      previewImport.mockRejectedValue(apiError(422, { message: 'something else' }));

      expect(await runPreview(input(), deps())).toMatchObject({
        step: 'error',
        errorStep: 'apply preview',
        errorAllowCredentialRetry: true,
      });
    });

    it('any other API error is formatted, and offers a retry', async () => {
      previewImport.mockRejectedValue(apiError(500, { message: 'boom' }));

      const patch = (await runPreview(input(), deps())) as { errorMessage: string; errorAllowCredentialRetry: boolean };

      expect(patch.errorAllowCredentialRetry).toBe(true);
      expect(patch.errorMessage).toContain('boom');
    });

    it('formats API errors more fully when verbose errors are on, adding the raw response', async () => {
      const body = { message: 'boom', details: { extra: 'a-distinctive-detail' } };
      previewImport.mockRejectedValue(apiError(500, body));

      const plain = (await runPreview(input(), deps({ verboseErrors: false }))) as { errorMessage: string };
      const verbose = (await runPreview(input(), deps({ verboseErrors: true }))) as { errorMessage: string };

      expect(verbose.errorMessage.length).toBeGreaterThan(plain.errorMessage.length);
      expect(verbose.errorMessage).toContain('a-distinctive-detail');
      expect(plain.errorMessage).not.toContain('a-distinctive-detail');
    });

    it('an ordinary error shows its message', async () => {
      previewImport.mockRejectedValue(new Error('socket hang up'));

      expect(await runPreview(input(), deps())).toEqual({
        step: 'error',
        errorStep: 'apply preview',
        errorMessage: 'socket hang up',
        errorAllowCredentialRetry: true,
      });
    });

    it('something thrown that is not an error gets a generic message', async () => {
      previewImport.mockRejectedValue('nope');

      expect(await runPreview(input(), deps())).toMatchObject({ errorMessage: 'Preview failed' });
    });

    it('a failure reading the tokens file is an error, not a crash', async () => {
      readTokens.mockRejectedValue(new Error('tokens.json is not valid JSON'));

      expect(await runPreview(input({ tokensPath: '/t.json' }), deps())).toMatchObject({
        step: 'error',
        errorMessage: 'tokens.json is not valid JSON',
      });
    });
  });
});

describe('handlePreview422', () => {
  const err = (status: number, body: unknown) =>
    new ApiError(`preview failed: ${status}`, status, JSON.stringify(body));

  it('is not a 422 for any other status', async () => {
    expect(await handlePreview422(err(500, {}), 's', vi.fn())).toEqual({ kind: 'not-422' });
  });

  it('is unparseable when the body names no component', async () => {
    const error = err(422, { message: 'x' });

    expect(await handlePreview422(error, 's', vi.fn())).toEqual({ kind: 'unparseable', message: error.message });
  });
});

describe('clearedValidationErrorState', () => {
  it('empties both lists', () => {
    expect(clearedValidationErrorState()).toEqual({ previewValidationErrors: [], previewValidationMissingNames: [] });
  });
});
