import { currentGenerationMemoryObservation } from './generation-memory-mode.js';
import { ImportMemoryCapacityError } from './evidence-memory-errors.js';
import { DEFAULT_EVIDENCE_MEMORY_POLICY } from './evidence-memory-policy.js';
const WORKER_STARTUP_BYTES = 64 * 1024 ** 2;
const INITIAL_EXPANSION = 3;

export const INDEXED_OWNER_MEASUREMENT_LIMITS = { maxNodes: 1_000_000, maxEntries: 4_000_000 } as const;

export interface EvidenceMemoryEstimate {
  inputBytes: number;
  queuedBytes: number;
  estimatedPeakBytes: number;
  measuredNodes: number;
  calibrationKey?: string;
}

export function estimateEvidenceMemory(
  input: unknown,
  options: { minimumPeakBytes?: number; maxNodes?: number; maxEntries?: number; maxDepth?: number } = {},
): EvidenceMemoryEstimate {
  const minimumPeakBytes = options.minimumPeakBytes ?? DEFAULT_EVIDENCE_MEMORY_POLICY.reservationBytes;
  const maxNodes = options.maxNodes ?? 200_000;
  const maxEntries = options.maxEntries ?? 1_000_000;
  const maxDepth = options.maxDepth ?? 256;
  if (!Number.isSafeInteger(minimumPeakBytes) || minimumPeakBytes < 0)
    throw new Error('Invalid evidence memory estimate minimum');
  for (const limit of [maxNodes, maxEntries, maxDepth])
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid evidence memory measurement limit');
  let inputBytes = 0;
  let queuedBytes = 0;
  let measuredNodes = 0;
  let measuredEntries = 0;
  let measuredDepth = 0;
  const observation = currentGenerationMemoryObservation();
  const seen = new WeakSet<object>();
  const failLimit = (): never => {
    throw new ImportMemoryCapacityError(
      'measurement-limit',
      DEFAULT_EVIDENCE_MEMORY_POLICY.budgetBytes,
      0,
      'Evidence memory measurement limit exceeded; use a bounded evidence handle.',
    );
  };
  const addText = (value: string) => {
    inputBytes += Buffer.byteLength(value);
    queuedBytes += 24 + value.length * 2;
  };
  function* entries(value: object): Generator<unknown> {
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++measuredEntries > maxEntries && !observation) failLimit();
      addText(key);
      queuedBytes += 24;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor))
        throw new ImportMemoryCapacityError(
          'measurement-limit',
          DEFAULT_EVIDENCE_MEMORY_POLICY.budgetBytes,
          0,
          'Evidence memory measurement cannot inspect accessors.',
        );
      yield descriptor.value;
    }
  }
  const stack: Iterator<unknown>[] = [[input][Symbol.iterator]()];
  while (stack.length) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    const value = next.value;
    if (typeof value === 'string') addText(value);
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      inputBytes += 8;
      queuedBytes += 16;
    } else if (value !== null && typeof value === 'object') {
      if (seen.has(value)) continue;
      seen.add(value);
      measuredDepth = Math.max(measuredDepth, stack.length);
      if ((++measuredNodes > maxNodes || stack.length > maxDepth) && !observation) failLimit();
      queuedBytes += 64;
      if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
        inputBytes += value.byteLength;
        queuedBytes += value.byteLength;
      } else if (ArrayBuffer.isView(value)) {
        stack.push([value.buffer][Symbol.iterator]());
      } else if (value instanceof Date) {
        inputBytes += 8;
      } else if (value instanceof Set) {
        stack.push(Set.prototype.values.call(value));
      } else if (value instanceof Map) {
        throw new ImportMemoryCapacityError(
          'measurement-limit',
          DEFAULT_EVIDENCE_MEMORY_POLICY.budgetBytes,
          0,
          'Evidence memory measurement requires plain data or a bounded evidence handle.',
        );
      } else stack.push(entries(value));
    }
  }
  const estimatedPeakBytes = Math.max(minimumPeakBytes, WORKER_STARTUP_BYTES + queuedBytes * INITIAL_EXPANSION);
  if (!Number.isSafeInteger(inputBytes) || !Number.isSafeInteger(estimatedPeakBytes)) failLimit();
  for (const [bound, count, limit] of [
    ['measurement-nodes', measuredNodes, maxNodes],
    ['measurement-entries', measuredEntries, maxEntries],
    ['measurement-depth', measuredDepth, maxDepth],
  ] as const) {
    if (count > limit)
      observation?.observe({
        bound,
        scope: 'estimate',
        observedBytes: inputBytes,
        estimatedBytes: estimatedPeakBytes,
        observedCount: count,
        limitCount: limit,
      });
  }
  return { inputBytes, queuedBytes, estimatedPeakBytes, measuredNodes };
}

export type EvidenceMemoryRole = 'source' | 'indexed' | 'validation';

export function createEvidenceMemoryEstimator() {
  const profiles = new Map<string, { expansion: number; peakBytes: number }>();
  const key = (role: EvidenceMemoryRole, operation?: string) => `${role}:${operation ?? ''}`;
  return {
    estimate: (
      role: EvidenceMemoryRole,
      input: unknown,
      options: Parameters<typeof estimateEvidenceMemory>[1] & { calibrationKey?: string } = {},
    ) => {
      const measured = estimateEvidenceMemory(input, options);
      const profile = profiles.get(key(role, options.calibrationKey));
      const estimatedPeakBytes = Math.max(
        measured.estimatedPeakBytes,
        options.calibrationKey === undefined
          ? Math.ceil(WORKER_STARTUP_BYTES + measured.queuedBytes * (profile?.expansion ?? INITIAL_EXPANSION))
          : (profile?.peakBytes ?? 0),
      );
      if (!Number.isSafeInteger(estimatedPeakBytes))
        throw new ImportMemoryCapacityError('reservation-too-large', DEFAULT_EVIDENCE_MEMORY_POLICY.budgetBytes, 0);
      return {
        ...measured,
        estimatedPeakBytes,
        ...(options.calibrationKey !== undefined ? { calibrationKey: options.calibrationKey } : {}),
      };
    },
    observe: (role: EvidenceMemoryRole, measured: EvidenceMemoryEstimate, observedBytes: number) => {
      if (
        !Number.isSafeInteger(observedBytes) ||
        observedBytes < 0 ||
        !Number.isSafeInteger(measured.queuedBytes) ||
        measured.queuedBytes < 0
      )
        throw new Error('Invalid evidence worker memory observation');
      const profileKey = key(role, measured.calibrationKey);
      const profile = profiles.get(profileKey) ?? { expansion: INITIAL_EXPANSION, peakBytes: 0 };
      if (measured.calibrationKey !== undefined) profile.peakBytes = Math.max(profile.peakBytes, observedBytes);
      else if (measured.queuedBytes > 0)
        profile.expansion = Math.max(
          profile.expansion,
          Math.max(0, observedBytes - WORKER_STARTUP_BYTES) / measured.queuedBytes,
        );
      profiles.delete(profileKey);
      profiles.set(profileKey, profile);
      if (profiles.size > 256) profiles.delete(profiles.keys().next().value!);
    },
  };
}

export const evidenceMemoryEstimator = createEvidenceMemoryEstimator();
