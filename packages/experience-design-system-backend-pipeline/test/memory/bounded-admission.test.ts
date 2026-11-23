import { expect, it, vi } from 'vitest';
import { createEvidenceWorkerCapacity } from '../../src/memory/evidence-worker-capacity.js';

const policy = {
  budgetBytes: 100,
  headroomFraction: 0,
  reservationBytes: 40,
  maxPreparing: 1,
  maxQueuedJobs: 8,
  maxQueuedBytes: 30,
};

it('uses measured peak reservations instead of a fixed amount for every admitted input', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const lease = await capacity.acquire('validation', undefined, undefined, { estimatedPeakBytes: 70, queuedBytes: 10 });
  expect(capacity.stats()).toMatchObject({ reservedBytes: 70 });
  lease.release();
  expect(capacity.stats().reservedBytes).toBe(0);
});

it('rejects oversized measured reservations before queuing or starting work', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  await expect(
    capacity.acquire('preparation', undefined, undefined, { estimatedPeakBytes: 101, queuedBytes: 10 }),
  ).rejects.toMatchObject({ reason: 'reservation-too-large' });
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, reservedBytes: 0, queuedBytes: 0 });
});

it('bounds the decoded bytes held by queued inputs and releases that accounting on cancellation', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const first = await capacity.acquire('preparation');
  const controller = new AbortController();
  const queued = capacity.acquire('preparation', controller.signal, undefined, {
    estimatedPeakBytes: 40,
    queuedBytes: 20,
  });
  const cancelled = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  expect(capacity.stats()).toMatchObject({ waiting: 1, queuedBytes: 20 });
  await expect(
    capacity.acquire('preparation', undefined, undefined, { estimatedPeakBytes: 40, queuedBytes: 11 }),
  ).rejects.toMatchObject({ reason: 'queue-bytes-full' });
  controller.abort();
  await cancelled;
  expect(capacity.stats()).toMatchObject({ waiting: 0, queuedBytes: 0, reservedBytes: 40 });
  first.release();
});

it('reports a real memory wait and its completion without reserving an agent slot', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const first = await capacity.acquire('preparation');
  const onWait = vi.fn();
  const queued = capacity.acquire('preparation', undefined, undefined, {
    estimatedPeakBytes: 40,
    queuedBytes: 10,
    onWait,
  });
  expect(onWait).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'waiting', queuedBytes: 10, reservedBytes: 40 }),
  );
  first.release();
  (await queued).release();
  expect(onWait).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'admitted', waitMs: expect.any(Number) }));
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, queuedBytes: 0 });
});

it.each([-1, NaN, Infinity, 1.5])(
  'rejects invalid input byte measurements (%s) without leaking an admission',
  async (bytes) => {
    const capacity = createEvidenceWorkerCapacity(policy, () => 0);
    await expect(
      capacity.acquire('preparation', undefined, undefined, { estimatedPeakBytes: bytes, queuedBytes: 0 }),
    ).rejects.toThrow('Invalid evidence memory estimate');
    expect(capacity.stats().active).toBe(0);
  },
);

it('accounts for retained decoded validator residency until its owner releases', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const owner = await capacity.acquire('preparation');
  owner.retainValidation(65);
  const started = vi.fn();
  const next = capacity.acquire('validation').then((lease) => {
    started();
    return lease;
  });
  await Promise.resolve();
  expect(started).not.toHaveBeenCalled();
  expect(capacity.stats()).toMatchObject({ retainedBytes: 65, reservedBytes: 0, waiting: 1 });
  owner.release();
  (await next).release();
  expect(capacity.stats()).toMatchObject({ retainedBytes: 0, active: 0, waiting: 0 });
});

it('keeps waiting recoverable when a progress observer throws', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const first = await capacity.acquire('preparation');
  const queued = capacity.acquire('preparation', undefined, undefined, {
    estimatedPeakBytes: 40,
    queuedBytes: 10,
    onWait: () => {
      throw new Error('Viewport closed');
    },
  });
  first.release();
  (await queued).release();
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, queuedBytes: 0, reservedBytes: 0 });
});
