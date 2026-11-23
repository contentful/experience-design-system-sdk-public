import { expect, it, vi } from 'vitest';
import * as memory from '../../src/memory/evidence-worker-capacity.js';

it('measures unique graph nodes and string expansion without serializing or invoking caller code', () => {
  const toJSON = vi.fn(() => {
    throw new Error('Serialization is prohibited');
  });
  const shared = { text: 'é'.repeat(1024) };
  const estimate = memory.estimateEvidenceMemory({ left: shared, right: shared, toJSON }, { minimumPeakBytes: 0 });
  expect(toJSON).not.toHaveBeenCalled();
  expect(estimate).toMatchObject({ measuredNodes: 2 });
  expect(estimate.inputBytes).toBeGreaterThanOrEqual(2048);
  expect(estimate.queuedBytes).toBeGreaterThan(estimate.inputBytes);
  expect(estimate.estimatedPeakBytes).toBeGreaterThan(estimate.queuedBytes);
  expect(
    memory.estimateEvidenceMemory({ left: { ...shared }, right: { ...shared } }, { minimumPeakBytes: 0 }).queuedBytes,
  ).toBeGreaterThan(estimate.queuedBytes);
});

it('bounds measurement work and refuses inputs whose estimates cannot be safely completed', () => {
  expect(() => memory.estimateEvidenceMemory([{ a: {} }, { b: {} }], { maxNodes: 2 })).toThrow(
    'Evidence memory measurement limit',
  );
  expect(() =>
    memory.estimateEvidenceMemory({
      get value() {
        throw new Error('Getter called');
      },
    }),
  ).toThrow('Evidence memory measurement cannot inspect accessors');
});

it('records complete large text sizes while keeping measurement metadata bounded', () => {
  const input = { content: 'x'.repeat(1024 * 1024) };
  const estimate = memory.estimateEvidenceMemory(input, { minimumPeakBytes: 0 });
  expect(estimate.measuredNodes).toBe(1);
  expect(estimate.inputBytes).toBeGreaterThanOrEqual(input.content.length);
  expect(estimate.queuedBytes).toBeGreaterThanOrEqual(input.content.length * 2);
});

it('calibrates future reservations from measured worker allocation without sharing unrelated roles', () => {
  const estimator = memory.createEvidenceMemoryEstimator();
  const input = { content: 'x'.repeat(1024 * 1024) };
  const first = estimator.estimate('indexed', input, { minimumPeakBytes: 0 });
  estimator.observe('indexed', first, 64 * 1024 ** 2 + first.queuedBytes * 8);
  expect(estimator.estimate('indexed', input, { minimumPeakBytes: 0 }).estimatedPeakBytes).toBeGreaterThan(
    first.estimatedPeakBytes,
  );
  expect(estimator.estimate('validation', input, { minimumPeakBytes: 0 }).estimatedPeakBytes).toBe(
    first.estimatedPeakBytes,
  );
  expect(() => estimator.observe('indexed', first, -1)).toThrow('Invalid evidence worker memory observation');
});

it('refuses an unsafe calibrated estimate recoverably rather than retrying a numeric overflow', () => {
  const estimator = memory.createEvidenceMemoryEstimator();
  const small = estimator.estimate('indexed', { value: 'x' });
  estimator.observe('indexed', small, Number.MAX_SAFE_INTEGER);
  expect(() => estimator.estimate('indexed', { value: 'x'.repeat(1024) })).toThrow(memory.ImportMemoryCapacityError);
});

it('does not let opaque extraction working sets inflate saving decisions for another operation', () => {
  const estimator = memory.createEvidenceMemoryEstimator();
  const extraction = estimator.estimate(
    'source',
    { projectPath: '/example' },
    { calibrationKey: 'extractAndComposeImport' },
  );
  estimator.observe('source', extraction, 1536 * 1024 ** 2);
  const decisions = {
    sessionId: 'example',
    decisions: {
      accepted: ['Panel'],
      rejected: Array.from({ length: 57 }, (_, i) => `Component${i}`),
    },
  };
  const baseline = memory.estimateEvidenceMemory(decisions);
  const save = estimator.estimate('source', decisions, { calibrationKey: 'saveImportScope' });
  expect(save.estimatedPeakBytes).toBe(baseline.estimatedPeakBytes);
  expect(
    estimator.estimate('source', { projectPath: '/example' }, { calibrationKey: 'extractAndComposeImport' })
      .estimatedPeakBytes,
  ).toBe(1536 * 1024 ** 2);
});

it('calibrates opaque handles by absolute peak instead of multiplying their metadata size', () => {
  const estimator = memory.createEvidenceMemoryEstimator();
  const small = estimator.estimate('source', { sessionId: 'a' }, { calibrationKey: 'loadSession' });
  estimator.observe('source', small, 1536 * 1024 ** 2);
  const larger = estimator.estimate(
    'source',
    { sessionId: 'a', optionalMetadata: 'x'.repeat(1024 * 1024) },
    { calibrationKey: 'loadSession' },
  );
  expect(larger.estimatedPeakBytes).toBe(1536 * 1024 ** 2);
  const ownPeak = estimator.estimate('source', {}, { calibrationKey: 'saveImportScope' });
  estimator.observe('source', ownPeak, 4 * 1024 ** 3);
  expect(estimator.estimate('source', {}, { calibrationKey: 'saveImportScope' }).estimatedPeakBytes).toBe(
    4 * 1024 ** 3,
  );
});
