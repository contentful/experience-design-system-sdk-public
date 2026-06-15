import { describe, it, expect } from 'vitest';
import { PREVIEW_ERROR_PREFIX, APPLY_ERROR_PREFIX } from '../../src/apply/api-client.js';
import { isPreviewValidationError, parseOffendingComponentNames } from '../../src/import/orchestrator.js';

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
});
