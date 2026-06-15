import { describe, it, expect, vi } from 'vitest';
import {
  handlePreview422,
  applySkipValidationErrors,
  clearedValidationErrorState,
} from '../../../src/import/tui/wizard-422-helpers.js';
import { ApiError } from '../../../src/apply/api-client.js';

const VALID_BODY = JSON.stringify({
  sys: { type: 'Error', id: 'ValidationFailed' },
  message: 'Validation error',
  details: {
    errors: [
      { path: 'manifest:components/PageLink/$slots/', message: 'Slot id must be a non-empty string' },
      { path: 'manifest:components/Button/$properties/variant', message: 'variant required' },
    ],
  },
});

describe('handlePreview422 — routing', () => {
  it("returns 'not-422' for non-422 ApiErrors so the caller falls through", async () => {
    const err = new ApiError('preview failed: 500', 500, '{}');
    const result = await handlePreview422(err, 'sess-1', vi.fn());

    expect(result).toEqual({ kind: 'not-422' });
  });

  it("returns 'unparseable' when body has no parseable component errors", async () => {
    const err = new ApiError('preview failed: 422', 422, 'not json');
    const patch = vi.fn();

    const result = await handlePreview422(err, 'sess-1', patch);

    expect(result.kind).toBe('unparseable');
    if (result.kind === 'unparseable') {
      expect(result.message).toContain('preview failed: 422');
    }
    // Crucial: do NOT mutate state when we can't parse — otherwise we'd write
    // synthetic SERVER_VALIDATION_FAILED issues with no useful component name.
    expect(patch).not.toHaveBeenCalled();
  });

  it("returns 'unparseable' when details.errors is missing", async () => {
    const err = new ApiError('preview failed: 422', 422, JSON.stringify({ message: 'no errors here' }));
    const patch = vi.fn();

    const result = await handlePreview422(err, 'sess-1', patch);

    expect(result.kind).toBe('unparseable');
    expect(patch).not.toHaveBeenCalled();
  });

  it('calls patchFn with the parsed errors and returns missingNames in the validation-error outcome', async () => {
    const err = new ApiError('preview failed: 422', 422, VALID_BODY);
    const patch = vi.fn().mockResolvedValue({ patchedNames: ['PageLink'], missingNames: ['Button'] });

    const result = await handlePreview422(err, 'sess-42', patch);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('sess-42', [
      {
        componentName: 'PageLink',
        path: 'manifest:components/PageLink/$slots/',
        message: 'Slot id must be a non-empty string',
      },
      {
        componentName: 'Button',
        path: 'manifest:components/Button/$properties/variant',
        message: 'variant required',
      },
    ]);

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.errors.map((e) => e.componentName)).toEqual(['PageLink', 'Button']);
      expect(result.missingNames).toEqual(['Button']);
    }
  });

  it('skips the patchFn call entirely when there is no extractSessionId', async () => {
    const err = new ApiError('preview failed: 422', 422, VALID_BODY);
    const patch = vi.fn();

    const result = await handlePreview422(err, null, patch);

    // No session means no review state file to patch — but we still want the
    // wizard to render the validation-error step so the user sees what failed.
    expect(patch).not.toHaveBeenCalled();
    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.errors).toHaveLength(2);
      expect(result.missingNames).toEqual([]);
    }
  });

  it('uses the default patchFn when none is supplied (smoke check the binding)', async () => {
    // We don't actually invoke the real DB-backed default — just confirm the
    // signature compiles and the default is not undefined. A 'not-422' error
    // short-circuits before the default can run.
    const err = new ApiError('preview failed: 500', 500, '{}');
    const result = await handlePreview422(err, 'sess-1');
    expect(result).toEqual({ kind: 'not-422' });
  });
});

describe('applySkipValidationErrors', () => {
  it('dedups by componentName and calls rejectFn once with the unique names', async () => {
    const reject = vi.fn().mockResolvedValue(undefined);
    const errors = [
      { componentName: 'PageLink', path: 'manifest:components/PageLink/$slots/', message: 'a' },
      { componentName: 'PageLink', path: 'manifest:components/PageLink/$slots/foo', message: 'b' },
      { componentName: 'Button', path: 'manifest:components/Button/$properties/v', message: 'c' },
    ];

    const names = await applySkipValidationErrors('sess-1', errors, reject);

    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith('sess-1', ['PageLink', 'Button']);
    expect(names).toEqual(['PageLink', 'Button']);
  });

  it('returns [] without calling rejectFn when sessionId is null', async () => {
    const reject = vi.fn();
    const names = await applySkipValidationErrors(null, [], reject);

    expect(reject).not.toHaveBeenCalled();
    expect(names).toEqual([]);
  });

  it('returns [] without calling rejectFn when errors is empty', async () => {
    const reject = vi.fn();
    const names = await applySkipValidationErrors('sess-1', [], reject);

    expect(reject).not.toHaveBeenCalled();
    expect(names).toEqual([]);
  });
});

describe('clearedValidationErrorState', () => {
  // The validation-error step state lives in the WizardState across
  // preview attempts. When a retry succeeds and we move to preview-gate,
  // the wizard MUST clear these fields — otherwise the state lingers and
  // any future transition that re-renders the validation-error step (or a
  // future feature that reads the field) sees stale data from a previous
  // failed attempt.
  //
  // Hoisting this as a tiny pure helper makes the contract explicit and
  // testable. The wizard spreads this object into the preview-gate update.

  it('returns a patch that empties both validation-error fields', () => {
    expect(clearedValidationErrorState()).toEqual({
      previewValidationErrors: [],
      previewValidationMissingNames: [],
    });
  });

  it('returns a fresh object each call (no shared-reference aliasing)', () => {
    const a = clearedValidationErrorState();
    const b = clearedValidationErrorState();
    expect(a).not.toBe(b);
    expect(a.previewValidationErrors).not.toBe(b.previewValidationErrors);
    expect(a.previewValidationMissingNames).not.toBe(b.previewValidationMissingNames);
  });
});
