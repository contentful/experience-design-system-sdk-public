import { describe, it, expect } from 'vitest';
import { ApiError, PREVIEW_ERROR_PREFIX, APPLY_ERROR_PREFIX } from '../../src/apply/api-client.js';
import {
  isPreviewValidationError,
  parseOffendingComponentNames,
  buildPushStepResult,
} from '../../src/import/orchestrator.js';

// ─── Unit tests for the two orchestrator helpers ────────────────────────────

const VALIDATION_FAILED_BODY = JSON.stringify({
  sys: { type: 'Error', id: 'ValidationFailed' },
  message: 'Validation error',
  details: {
    errors: [
      { path: 'manifest:components/PageLink/$slots/', message: 'Slot id must be a non-empty string' },
      { path: 'manifest:components/Hero/$properties/title', message: 'Property name collision' },
    ],
  },
});

describe('isPreviewValidationError', () => {
  it('returns true for a preview-phase 422 with ValidationFailed body', () => {
    expect(
      isPreviewValidationError({
        exitCode: 1,
        stderr: `Error: ${PREVIEW_ERROR_PREFIX} 422\n${VALIDATION_FAILED_BODY}`,
      }),
    ).toBe(true);
  });

  it('returns false when exitCode is 0', () => {
    expect(
      isPreviewValidationError({
        exitCode: 0,
        stderr: `Error: ${PREVIEW_ERROR_PREFIX} 422\n${VALIDATION_FAILED_BODY}`,
      }),
    ).toBe(false);
  });

  it('returns false for an apply-phase 422 (not retryable)', () => {
    expect(
      isPreviewValidationError({
        exitCode: 1,
        stderr: `Error: ${APPLY_ERROR_PREFIX} 422\n${VALIDATION_FAILED_BODY}`,
      }),
    ).toBe(false);
  });

  it('returns false for a preview 401 (wrong status code)', () => {
    expect(
      isPreviewValidationError({
        exitCode: 1,
        stderr: `Error: ${PREVIEW_ERROR_PREFIX} 401\n{"sys":{"type":"Error","id":"AccessDenied"}}`,
      }),
    ).toBe(false);
  });

  it('returns false for a preview 422 without ValidationFailed in the body', () => {
    expect(
      isPreviewValidationError({
        exitCode: 1,
        stderr: `Error: ${PREVIEW_ERROR_PREFIX} 422\n{"sys":{"type":"Error","id":"UnprocessableEntity"}}`,
      }),
    ).toBe(false);
  });

  it('returns false for a generic non-zero exit with no API error marker', () => {
    expect(
      isPreviewValidationError({
        exitCode: 1,
        stderr: 'Error: something else went wrong',
      }),
    ).toBe(false);
  });
});

describe('parseOffendingComponentNames', () => {
  it('extracts unique component names from a validation error body embedded in stderr', () => {
    const stderr = `Error: ${PREVIEW_ERROR_PREFIX} 422\n${VALIDATION_FAILED_BODY}`;
    const names = parseOffendingComponentNames(stderr);
    expect(names).toEqual(expect.arrayContaining(['PageLink', 'Hero']));
    expect(names).toHaveLength(2);
  });

  it('deduplicates when the same component appears in multiple errors', () => {
    const body = JSON.stringify({
      sys: { type: 'Error', id: 'ValidationFailed' },
      details: {
        errors: [
          { path: 'manifest:components/Button/$slots/icon', message: 'error 1' },
          { path: 'manifest:components/Button/$properties/label', message: 'error 2' },
        ],
      },
    });
    const names = parseOffendingComponentNames(`Error: ${PREVIEW_ERROR_PREFIX} 422\n${body}`);
    expect(names).toEqual(['Button']);
  });

  it('returns [] when no JSON object is present in the output', () => {
    expect(parseOffendingComponentNames(`Error: ${PREVIEW_ERROR_PREFIX} 422 — no body`)).toEqual([]);
  });

  it('returns [] when the JSON does not have the expected ValidationFailed shape', () => {
    const body = JSON.stringify({ message: 'some other error' });
    expect(parseOffendingComponentNames(`Error: something\n${body}`)).toEqual([]);
  });

  it('returns [] for empty string input', () => {
    expect(parseOffendingComponentNames('')).toEqual([]);
  });

  it('extracts every offender from a realistic large 422 body — full path through ApiError + die()', () => {
    // End-to-end against the truncation regression: build a body big enough
    // to have hit the original ApiError 1000-char trim, then route it through
    // the actual ApiError ctor (which is what apply/command.ts uses) and
    // simulate die()'s exact stderr format. This exercises the full chain
    // the orchestrator sees, rather than feeding the parser a synthetic
    // pre-trimmed string.
    const errors = Array.from({ length: 20 }, (_, i) => ({
      path: `manifest:components/Component${i}/$slots/`,
      message: `Slot id must be a non-empty string for Component${i}`,
    }));
    const body = JSON.stringify({
      sys: { type: 'Error', id: 'ValidationFailed' },
      message: 'Validation error',
      details: { errors },
    });
    expect(body.length).toBeGreaterThan(1000);

    // ApiError ctor → die() writes `Error: ${e.message}\n` to stderr, where
    // e.message is `${prefix} ${status}\n${trimmedBody}`. So the wire format
    // matches what the orchestrator reads via runStep.
    const apiErr = new ApiError(`${PREVIEW_ERROR_PREFIX} 422`, 422, body);
    const stderr = `Error: ${apiErr.message}\n`;

    const names = parseOffendingComponentNames(stderr);
    expect(names).toHaveLength(20);
    expect(names).toEqual(Array.from({ length: 20 }, (_, i) => `Component${i}`));
  });
});

describe('buildPushStepResult', () => {
  // Pure shape test for the apply-push step record. The retry-loop
  // bookkeeping (excludedByValidationRetry) must surface in BOTH the success
  // and the failure result so a downstream consumer (status report, audit
  // log, future re-run logic) always knows what was auto-excluded — even
  // when retries were exhausted and the push ultimately failed.

  it('records counts and excludedByValidationRetry on success', () => {
    const result = buildPushStepResult({
      created: 3,
      updated: 1,
      failed: 0,
      durationMs: 1234,
      stderr: '',
      excludedByRetry: ['Foo', 'Bar'],
    });
    expect(result).toEqual({
      step: 'apply push',
      status: 'complete',
      durationMs: 1234,
      detail: { created: 3, updated: 1, failed: 0, excludedByValidationRetry: ['Foo', 'Bar'] },
    });
  });

  it('omits excludedByValidationRetry from detail when no retries ran', () => {
    const result = buildPushStepResult({
      created: 5,
      updated: 0,
      failed: 0,
      durationMs: 100,
      stderr: '',
      excludedByRetry: [],
    });
    expect(result.detail).toEqual({ created: 5, updated: 0, failed: 0 });
    expect(result.detail).not.toHaveProperty('excludedByValidationRetry');
  });

  it('flags partial-failure (some failed but not all) as status=failed and keeps the counts', () => {
    const result = buildPushStepResult({
      created: 2,
      updated: 0,
      failed: 1,
      durationMs: 200,
      stderr: '',
      excludedByRetry: [],
    });
    expect(result.status).toBe('failed');
    expect(result.detail).toEqual({ created: 2, updated: 0, failed: 1 });
  });

  it('records error AND excludedByValidationRetry on total failure (retry-exhausted scenario)', () => {
    // This is the regression: previously the failure path only set
    // {step, status, durationMs, error} — a user looking at a failed
    // pipeline run had no record of which components were auto-excluded
    // before the loop gave up.
    const result = buildPushStepResult({
      created: 0,
      updated: 0,
      failed: 0,
      durationMs: 999,
      stderr: 'Error: preview failed: 422\n{...}',
      excludedByRetry: ['PageLink', 'Hero'],
      totalFailure: true,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Error: preview failed: 422\n{...}');
    expect(result.detail).toEqual({ excludedByValidationRetry: ['PageLink', 'Hero'] });
  });

  it('total-failure with no retries records error only, no detail', () => {
    const result = buildPushStepResult({
      created: 0,
      updated: 0,
      failed: 0,
      durationMs: 50,
      stderr: 'Error: something else',
      excludedByRetry: [],
      totalFailure: true,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Error: something else');
    expect(result.detail).toBeUndefined();
  });
});
