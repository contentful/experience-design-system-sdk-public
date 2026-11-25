import {
  currentGenerationMemoryObservation,
  observeGenerationMemoryBound,
} from '../../memory/generation-memory-mode.js';
import { SourceIsolationError } from './errors.js';
import { types } from 'node:util';
import { serialize, deserialize, getHeapStatistics } from 'node:v8';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

export interface TransportLimits {
  maxBytes: number;
  maxGraphBytes: number;
  maxNodes: number;
  maxEntries: number;
  maxDepth: number;
  parentRssLimitBytes: number;
}

export interface TransportHandle {
  version: 1;
  owner: string;
  role: 'request' | 'result';
  bytes: number;
  graphBytes: number;
  digest: string;
}

export const defaultTransportLimits: TransportLimits = Object.freeze({
  maxBytes: 4 * 1024 ** 2,
  maxGraphBytes: 16 * 1024 ** 2,
  maxNodes: 32768,
  maxEntries: 65536,
  maxDepth: 128,
  parentRssLimitBytes: 3 * 1024 ** 3,
});

export function validateTransportLimits(limits: TransportLimits): void {
  for (const key of [
    'maxBytes',
    'maxGraphBytes',
    'maxNodes',
    'maxEntries',
    'maxDepth',
    'parentRssLimitBytes',
  ] as const) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > defaultTransportLimits[key])
      throw new Error('Invalid source transport limit.');
  }
}

export function measureTransportValue(
  value: unknown,
  operation: string,
  role: 'request' | 'result',
  limits = defaultTransportLimits,
): number {
  validateTransportLimits(limits);
  const seen = new WeakSet<object>();
  let bytes = 64;
  let entries = 0;
  let nodes = 0;
  let maxDepth = 0;
  const observation = currentGenerationMemoryObservation();
  const reject = (unsupported = false): never => {
    throw new SourceIsolationError({
      reason: unsupported ? 'unsupported-value' : `${role}-too-large`,
      operation,
      scope: role,
      limitBytes: limits.maxGraphBytes,
    });
  };
  const charge = (amount: number) => {
    bytes += amount;
    if ((bytes > limits.maxGraphBytes || bytes > limits.maxBytes) && !observation) reject();
  };
  function* visit(item: unknown, depth: number): Generator<{ item: unknown; depth: number }> {
    maxDepth = Math.max(maxDepth, depth);
    if ((++entries > limits.maxEntries || depth > limits.maxDepth) && !observation) reject();
    charge(32);
    if (typeof item === 'string') {
      charge(item.length * 8 + 16);
      return;
    }
    if (typeof item === 'bigint') {
      if (item < -(1n << 64n) || item >= 1n << 64n) reject(true);
      charge(32);
      return;
    }
    if (typeof item === 'function' || typeof item === 'symbol') reject(true);
    if (item === null || typeof item !== 'object') return;
    if (types.isProxy(item) || types.isSharedArrayBuffer(item)) reject(true);
    if (seen.has(item)) return;
    seen.add(item);
    if (++nodes > limits.maxNodes && !observation) reject();
    charge(256);
    if (ArrayBuffer.isView(item)) {
      const prototype: object = types.isDataView(item)
        ? DataView.prototype
        : Object.getPrototypeOf(Uint8Array.prototype);
      const buffer: unknown = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(item);
      if (types.isSharedArrayBuffer(buffer)) reject(true);
      const byteLength: number = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(item);
      charge(byteLength * 2);
      return;
    }
    if (types.isArrayBuffer(item)) {
      const byteLength: number = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!.call(item);
      charge(byteLength * 2);
      return;
    }
    if (types.isDate(item)) return;
    if (types.isRegExp(item)) {
      const source: string = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!.call(item);
      charge(source.length * 8);
      return;
    }
    if (types.isMap(item)) {
      const size: number = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(item);
      if (size > limits.maxEntries && !observation) reject();
      for (const [key, member] of Map.prototype.entries.call(item)) {
        yield { item: key, depth: depth + 1 };
        yield { item: member, depth: depth + 1 };
      }
      return;
    }
    if (types.isSet(item)) {
      const size: number = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!.call(item);
      if (size > limits.maxEntries && !observation) reject();
      for (const member of Set.prototype.values.call(item)) yield { item: member, depth: depth + 1 };
      return;
    }
    if (Array.isArray(item)) {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Array.prototype && prototype !== null) reject(true);
      if (item.length > limits.maxEntries && !observation) reject();
      charge(item.length * 16);
    } else if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) reject(true);
    for (const key in item) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable) continue;
      charge(key.length * 8 + 32);
      if (!('value' in descriptor)) reject(true);
      yield { item: descriptor.value, depth: depth + 1 };
    }
  }
  const stack = [visit(value, 0)];
  while (stack.length) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) stack.pop();
    else stack.push(visit(next.value.item, next.value.depth));
  }
  for (const [bound, count, limit] of [
    ['transport-nodes', nodes, limits.maxNodes],
    ['transport-entries', entries, limits.maxEntries],
    ['transport-depth', maxDepth, limits.maxDepth],
  ] as const)
    if (count > limit)
      observation?.observe({
        bound,
        scope: role,
        operation,
        estimatedBytes: bytes,
        observedCount: count,
        limitCount: limit,
      });
  for (const [bound, limit] of [
    ['transport-graph', limits.maxGraphBytes],
    ['transport-bytes', limits.maxBytes],
  ] as const)
    if (bytes > limit)
      observation?.observe({ bound, scope: role, operation, estimatedBytes: bytes, limitBytes: limit });
  return bytes;
}

export function admitParentAllocation(
  graphBytes: number,
  operation: string,
  role: 'request' | 'result',
  limits: TransportLimits,
): void {
  const rss = process.memoryUsage.rss();
  const heap = getHeapStatistics();
  const allowance = graphBytes * 3 + limits.maxBytes * 2;
  if (
    rss * 2 + allowance > limits.parentRssLimitBytes ||
    heap.used_heap_size * 2 + allowance > heap.heap_size_limit * 0.8
  ) {
    if (
      observeGenerationMemoryBound({
        bound: 'parent-pressure',
        scope: role,
        operation,
        observedBytes: rss * 2 + allowance > limits.parentRssLimitBytes ? rss : heap.used_heap_size,
        estimatedBytes:
          rss * 2 + allowance > limits.parentRssLimitBytes ? rss * 2 + allowance : heap.used_heap_size * 2 + allowance,
        limitBytes:
          rss * 2 + allowance > limits.parentRssLimitBytes
            ? limits.parentRssLimitBytes
            : Math.floor(heap.heap_size_limit * 0.8),
      })
    )
      return;
    throw new SourceIsolationError({
      reason: 'parent-pressure',
      operation,
      scope: role,
      observedRssBytes: rss,
      observedHeapBytes: heap.used_heap_size,
      heapLimitBytes: heap.heap_size_limit,
      limitBytes: limits.parentRssLimitBytes,
    });
  }
}

export async function writeTransportValue(
  directory: string,
  owner: string,
  role: 'request' | 'result',
  value: unknown,
  operation: string,
  limits = defaultTransportLimits,
  parent = false,
): Promise<TransportHandle> {
  validateTransportLimits(limits);
  if (parent) admitParentAllocation(limits.maxGraphBytes, operation, role, limits);
  const graphBytes = measureTransportValue(value, operation, role, limits);
  if (parent) admitParentAllocation(graphBytes, operation, role, limits);
  const buffer = serialize(value);
  if (
    buffer.length > limits.maxBytes &&
    !observeGenerationMemoryBound({
      bound: 'transport-bytes',
      scope: role,
      operation,
      observedBytes: buffer.length,
      estimatedBytes: graphBytes,
      limitBytes: limits.maxBytes,
    })
  )
    throw new SourceIsolationError({
      reason: `${role}-too-large`,
      operation,
      scope: role,
      limitBytes: limits.maxBytes,
    });
  const file = await open(
    join(directory, `${role}.bin`),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(buffer);
  } finally {
    await file.close();
  }
  return {
    version: 1,
    owner,
    role,
    bytes: buffer.length,
    graphBytes,
    digest: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function readTransportValue(
  directory: string,
  owner: string,
  role: 'request' | 'result',
  handle: TransportHandle,
  operation: string,
  limits = defaultTransportLimits,
  parent = false,
): Promise<unknown> {
  const invalid = (): never => {
    throw new SourceIsolationError({ reason: 'invalid-handle', operation, scope: role });
  };
  validateTransportLimits(limits);
  if (
    !handle ||
    handle.version !== 1 ||
    handle.owner !== owner ||
    handle.role !== role ||
    !/^[a-f0-9]{64}$/.test(handle.digest) ||
    !Number.isSafeInteger(handle.bytes) ||
    handle.bytes < 1 ||
    !Number.isSafeInteger(handle.graphBytes) ||
    handle.graphBytes < 1
  )
    invalid();
  const observation = currentGenerationMemoryObservation();
  if (handle.bytes > limits.maxBytes)
    observation?.observe({
      bound: 'transport-bytes',
      scope: role,
      operation,
      observedBytes: handle.bytes,
      estimatedBytes: handle.graphBytes,
      limitBytes: limits.maxBytes,
    });
  if (handle.graphBytes > limits.maxGraphBytes)
    observation?.observe({
      bound: 'transport-graph',
      scope: role,
      operation,
      observedBytes: handle.bytes,
      estimatedBytes: handle.graphBytes,
      limitBytes: limits.maxGraphBytes,
    });
  if (!observation && (handle.bytes > limits.maxBytes || handle.graphBytes > limits.maxGraphBytes))
    throw new SourceIsolationError({
      reason: `${role}-too-large`,
      operation,
      scope: role,
      limitBytes: limits.maxGraphBytes,
    });
  if (parent) admitParentAllocation(handle.graphBytes, operation, role, limits);
  const file = await open(join(directory, `${role}.bin`), constants.O_RDONLY | constants.O_NOFOLLOW).catch(invalid);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== handle.bytes) invalid();
    if (parent) admitParentAllocation(handle.graphBytes, operation, role, limits);
    const buffer = Buffer.alloc(handle.bytes);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!read.bytesRead) invalid();
      offset += read.bytesRead;
    }
    if (createHash('sha256').update(buffer).digest('hex') !== handle.digest) invalid();
    if (parent) admitParentAllocation(handle.graphBytes, operation, role, limits);
    let value: unknown;
    try {
      value = deserialize(buffer);
    } catch {
      invalid();
    }
    if (measureTransportValue(value, operation, role, limits) > handle.graphBytes) invalid();
    return value;
  } finally {
    await file.close();
  }
}
