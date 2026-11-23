import { expect, it, vi } from 'vitest';
import { createEvidenceWorkerCapacity, type EvidenceMemoryRequest } from '../../src/memory/evidence-worker-capacity.js';
import { withEvidenceMemoryScope } from '../../src/memory/evidence-memory-scope.js';

const childPid = process.pid + 1;
const otherChildPid = process.pid + 2;
const policy = { budgetBytes: 100, headroomFraction: 0, reservationBytes: 10, maxPreparing: 1, maxQueuedJobs: 8 };
const childRequest = (bytes: number): EvidenceMemoryRequest => ({
  process: 'child',
  estimatedPeakBytes: bytes,
  queuedBytes: 0,
  independentRelease: true,
});

it('reserves prospective child allocations separately from already visible parent allocations before a sample', async () => {
  let parentRss = 20;
  const capacity = createEvidenceWorkerCapacity(policy, () => parentRss);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(40));
  parentRss = 60;
  const started = vi.fn();
  const pending = capacity.acquire('validation', undefined, undefined, childRequest(30)).then((lease) => {
    started();
    return lease;
  });
  await Promise.resolve();
  try {
    expect(started).not.toHaveBeenCalled();
    expect(capacity.stats()).toMatchObject({ accountedChildBytes: 40, childProcesses: 0, waiting: 1 });
  } finally {
    child.release();
    (await pending).release();
  }
});

it('raises aggregate admission pressure when an owned child exceeds its estimate', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(30));
  child.observeChildProcess?.({ pid: childPid, rssBytes: 70 });
  const started = vi.fn();
  const pending = capacity.acquire('validation', undefined, undefined, childRequest(25)).then((lease) => {
    started();
    return lease;
  });
  await Promise.resolve();
  try {
    expect(started).not.toHaveBeenCalled();
    expect(capacity.stats()).toMatchObject({
      aggregateRssBytes: 90,
      observedChildRssBytes: 70,
      accountedChildBytes: 70,
      waiting: 1,
    });
  } finally {
    child.release();
    (await pending).release();
  }
});

it('reserves parent transport and hydration allowance independently of the whole-child grant', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('validation', undefined, undefined, {
    ...childRequest(60),
    parentReservationBytes: 10,
  });
  child.observeChildProcess?.({ pid: childPid, rssBytes: 30 });
  const started = vi.fn();
  const pending = capacity.acquire('validation', undefined, undefined, childRequest(20)).then((lease) => {
    started();
    return lease;
  });
  await Promise.resolve();
  try {
    expect(started).not.toHaveBeenCalled();
    expect(capacity.stats()).toMatchObject({ accountedChildBytes: 60, reservedBytes: 70, waiting: 1 });
  } finally {
    child.release();
    (await pending).release();
  }
});

it('refuses a combined child and parent prospective allocation that cannot fit before clone', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  await expect(
    capacity.acquire('validation', undefined, undefined, {
      ...childRequest(90),
      parentReservationBytes: 20,
    }),
  ).rejects.toMatchObject({ reason: 'reservation-too-large' });
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0 });
});

it('counts an estimate and its overlapping child observation once instead of summing both', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(40));
  child.observeChildProcess?.({ pid: childPid, rssBytes: 30 });
  const next = await capacity.acquire('validation', undefined, undefined, childRequest(30));
  expect(capacity.stats()).toMatchObject({
    aggregateRssBytes: 50,
    accountedChildBytes: 70,
    reservedBytes: 70,
    active: 2,
  });
  next.release();
  child.release();
});

it('reports a sampled fall but retains peak pressure until owned cleanup releases prospective capacity', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(30));
  child.observeChildProcess?.({ pid: childPid, rssBytes: 70 });
  const started = vi.fn();
  const pending = capacity.acquire('validation', undefined, undefined, childRequest(25)).then((lease) => {
    started();
    return lease;
  });
  child.observeChildProcess?.({ pid: childPid, rssBytes: 10 });
  await Promise.resolve();
  try {
    expect(started).not.toHaveBeenCalled();
    expect(capacity.stats()).toMatchObject({
      aggregateRssBytes: 30,
      observedChildRssBytes: 10,
      accountedChildBytes: 70,
      childProcesses: 1,
    });
  } finally {
    child.release();
    (await pending).release();
  }
  expect(capacity.stats()).toMatchObject({ observedChildRssBytes: 0, accountedChildBytes: 0, childProcesses: 0 });
});

it('counts distinct owned processes once and replaces repeated samples without retaining sample history', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 10);
  const first = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  const second = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  first.observeChildProcess?.({ pid: childPid, rssBytes: 20 });
  second.observeChildProcess?.({ pid: otherChildPid, rssBytes: 25 });
  for (let index = 0; index < 1000; index++) first.observeChildProcess?.({ pid: childPid, rssBytes: 22 });
  expect(capacity.stats()).toMatchObject({
    childProcesses: 2,
    observedChildRssBytes: 47,
    aggregateRssBytes: 57,
    accountedChildBytes: 47,
  });
  first.release();
  expect(capacity.stats()).toMatchObject({ childProcesses: 1, observedChildRssBytes: 25 });
  second.release();
});

it('refuses duplicate cross-lease process ownership without charging the same RSS twice', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 10);
  const first = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  const second = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  first.observeChildProcess?.({ pid: childPid, rssBytes: 20 });
  expect(() => second.observeChildProcess?.({ pid: childPid, rssBytes: 30 })).toThrow(/already owned/i);
  expect(capacity.stats()).toMatchObject({ childProcesses: 1, observedChildRssBytes: 20, accountedChildBytes: 30 });
  first.release();
  second.observeChildProcess?.({ pid: childPid, rssBytes: 30 });
  expect(capacity.stats()).toMatchObject({ childProcesses: 1, observedChildRssBytes: 30 });
  second.release();
});

it('binds samples to the exact live work lease and refuses a changed process identity', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 10);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  child.observeChildProcess?.({ pid: childPid, rssBytes: 20 });
  expect(() => child.observeChildProcess?.({ pid: otherChildPid, rssBytes: 25 })).toThrow(/identity/i);
  expect(capacity.stats()).toMatchObject({ childProcesses: 1, observedChildRssBytes: 20 });
  child.release();
  expect(() => child.observeChildProcess?.({ pid: childPid, rssBytes: 25 })).toThrow(/released/i);
  child.release();
  expect(capacity.stats()).toMatchObject({ childProcesses: 0, observedChildRssBytes: 0, active: 0 });
});

it('counts shared parent worker threads and modeled parent residency through one parent RSS authority', async () => {
  let parentRss = 20;
  const capacity = createEvidenceWorkerCapacity(policy, () => parentRss);
  const worker = await capacity.acquire('validation', undefined, undefined, { estimatedPeakBytes: 40, queuedBytes: 0 });
  worker.retainValidation(40);
  parentRss = 80;
  expect(() => worker.observeChildProcess?.({ pid: process.pid, rssBytes: 80 })).toThrow(/child/i);
  const next = await capacity.acquire('validation', undefined, undefined, { estimatedPeakBytes: 10, queuedBytes: 0 });
  expect(capacity.stats()).toMatchObject({
    aggregateRssBytes: 80,
    observedChildRssBytes: 0,
    accountedChildBytes: 0,
    active: 2,
  });
  next.release();
  worker.release();
});

it.each([
  { pid: 0, rssBytes: 10 },
  { pid: -1, rssBytes: 10 },
  { pid: 1.5, rssBytes: 10 },
  { pid: process.pid, rssBytes: 10 },
  { pid: childPid, rssBytes: -1 },
  { pid: childPid, rssBytes: Infinity },
  { pid: childPid, rssBytes: NaN },
  { pid: childPid, rssBytes: Number.MAX_SAFE_INTEGER + 1 },
])('refuses malformed or parent-process samples without changing ownership: %j', async (sample) => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 10);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  expect(() => child.observeChildProcess?.(sample)).toThrow(/child/i);
  expect(capacity.stats()).toMatchObject({ childProcesses: 0, observedChildRssBytes: 0, accountedChildBytes: 10 });
  child.release();
});

it('cancels a child-pressure queue wait without releasing another owner or advertising invocation work', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(30));
  child.observeChildProcess?.({ pid: childPid, rssBytes: 70 });
  const controller = new AbortController();
  const onWait = vi.fn();
  const pending = capacity.acquire('validation', controller.signal, undefined, { ...childRequest(25), onWait });
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await cancelled;
  expect(onWait).toHaveBeenCalledWith(expect.objectContaining({ state: 'waiting' }));
  expect(onWait).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cancelled' }));
  expect(capacity.stats()).toMatchObject({ active: 1, childProcesses: 1, accountedChildBytes: 70, waiting: 0 });
  child.release();
});

it('keeps child residency owned through ready-state retention until explicit joined release', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('preparation', undefined, undefined, {
    ...childRequest(40),
    parentReservationBytes: 10,
  });
  child.observeChildProcess?.({ pid: childPid, rssBytes: 30 });
  child.retainValidation(5);
  expect(capacity.stats()).toMatchObject({
    preparing: 0,
    retainedValidation: 1,
    retainedBytes: 40,
    reservedBytes: 10,
    accountedChildBytes: 40,
    childProcesses: 1,
  });
  child.release();
  expect(capacity.stats()).toMatchObject({
    active: 0,
    childProcesses: 0,
    retainedBytes: 0,
    reservedBytes: 0,
    accountedChildBytes: 0,
  });
});

it.each([-1, 1.5, Infinity, NaN])('rejects invalid prospective parent allowance %s before admission', async (bytes) => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  await expect(
    capacity.acquire('validation', undefined, undefined, { ...childRequest(10), parentReservationBytes: bytes }),
  ).rejects.toThrow('Invalid evidence memory estimate');
  expect(capacity.stats()).toMatchObject({ active: 0, reservedBytes: 0 });
});

it('refuses aggregate sample overflow before mutating another process observation', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 10);
  const first = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  const second = await capacity.acquire('validation', undefined, undefined, childRequest(10));
  first.observeChildProcess?.({ pid: childPid, rssBytes: Number.MAX_SAFE_INTEGER - 100 });
  expect(() => second.observeChildProcess?.({ pid: otherChildPid, rssBytes: 150 })).toThrow(/aggregate child/i);
  expect(capacity.stats()).toMatchObject({ childProcesses: 1, observedChildRssBytes: Number.MAX_SAFE_INTEGER - 100 });
  second.release();
  first.release();
});

it('refuses a nested child allocation when the same waiting work owns the only retained releaser', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  await withEvidenceMemoryScope({ owner: Symbol('example work') }, async () => {
    const child = await capacity.acquire('preparation', undefined, undefined, childRequest(30));
    child.observeChildProcess?.({ pid: childPid, rssBytes: 70 });
    child.retainValidation();
    try {
      await expect(capacity.acquire('preparation', undefined, undefined, childRequest(25))).rejects.toMatchObject({
        reason: 'dependency-wait',
        observedRssBytes: 90,
      });
    } finally {
      child.release();
    }
  });
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, childProcesses: 0 });
});

it('preserves FIFO admission under child pressure when a smaller later request would fit', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 20);
  const child = await capacity.acquire('validation', undefined, undefined, childRequest(30));
  child.observeChildProcess?.({ pid: childPid, rssBytes: 60 });
  const order: string[] = [];
  const first = capacity.acquire('validation', undefined, undefined, childRequest(30)).then((lease) => {
    order.push('first');
    return lease;
  });
  const second = capacity.acquire('validation', undefined, undefined, childRequest(10)).then((lease) => {
    order.push('second');
    return lease;
  });
  await Promise.resolve();
  expect(order).toEqual([]);
  expect(capacity.stats().waiting).toBe(2);
  child.release();
  (await first).release();
  (await second).release();
  expect(order).toEqual(['first', 'second']);
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, childProcesses: 0 });
});

it.each(['result', 'failure', 'cancelled'] as const)(
  'keeps accounting through joined close, hydration and cleanup on %s settlement',
  async (settlement) => {
    let parentRss = 20;
    const capacity = createEvidenceWorkerCapacity(policy, () => parentRss);
    const child = await capacity.acquire('validation', undefined, undefined, childRequest(30));
    child.observeChildProcess?.({ pid: childPid, rssBytes: 70 });
    let closed!: () => void, hydrated!: () => void, cleaned!: () => void;
    const close = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const hydrate = new Promise<void>((resolve) => {
      hydrated = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
      cleaned = resolve;
    });
    const owned = (async () => {
      try {
        await close;
        child.observeChildProcess?.({ pid: childPid, rssBytes: 0 });
        await hydrate;
        if (settlement !== 'result') throw new Error(settlement);
      } finally {
        await cleanup;
        child.release();
      }
    })();
    const outcome =
      settlement === 'result' ? expect(owned).resolves.toBeUndefined() : expect(owned).rejects.toThrow(settlement);
    const started = vi.fn();
    const pending = capacity.acquire('validation', undefined, undefined, childRequest(25)).then((lease) => {
      started();
      return lease;
    });
    closed();
    await Promise.resolve();
    expect(started).not.toHaveBeenCalled();
    parentRss = 40;
    hydrated();
    await Promise.resolve();
    expect(capacity.stats()).toMatchObject({ childProcesses: 1, accountedChildBytes: 70, waiting: 1 });
    cleaned();
    await outcome;
    (await pending).release();
    expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, childProcesses: 0, observedChildRssBytes: 0 });
  },
);
