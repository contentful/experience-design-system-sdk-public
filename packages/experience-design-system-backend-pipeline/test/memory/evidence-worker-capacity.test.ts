import { expect, it, vi } from 'vitest';
import { createEvidenceWorkerCapacity, ImportMemoryCapacityError } from '../../src/memory/evidence-worker-capacity.js';

const policy = { budgetBytes: 100, headroomFraction: 0, reservationBytes: 40, maxPreparing: 1, maxQueuedJobs: 2 };

it('queues independent preparation while retaining capacity for a running task, then releases exactly once', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const first = await capacity.acquire('preparation');
  const resumed = vi.fn();
  const next = capacity.acquire('preparation').then((lease) => {
    resumed();
    return lease;
  });
  await Promise.resolve();
  expect(resumed).not.toHaveBeenCalled();
  expect(capacity.stats()).toMatchObject({ active: 1, waiting: 1, reservedBytes: 40 });
  first.release();
  first.release();
  const second = await next;
  expect(resumed).toHaveBeenCalledOnce();
  second.release();
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, reservedBytes: 0 });
});

it('keeps validator reservations for their entire lifetime while allowing independent small workers within budget', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const first = await capacity.acquire('validation');
  const second = await capacity.acquire('validation');
  const ready = vi.fn();
  const third = capacity.acquire('validation').then((lease) => {
    ready();
    return lease;
  });
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  expect(capacity.stats()).toMatchObject({ active: 2, reservedBytes: 80, waiting: 1 });
  first.release();
  (await third).release();
  second.release();
  expect(capacity.stats().reservedBytes).toBe(0);
});

it('removes cancelled queued work without releasing another task reservation', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const first = await capacity.acquire('preparation');
  const controller = new AbortController();
  const queued = capacity.acquire('preparation', controller.signal);
  const cancelled = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await cancelled;
  expect(capacity.stats()).toMatchObject({ active: 1, waiting: 0, reservedBytes: 40 });
  first.release();
});

it('rejects idle memory pressure recoverably rather than starting work or waiting forever', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 90);
  await expect(capacity.acquire('validation')).rejects.toBeInstanceOf(ImportMemoryCapacityError);
  expect(capacity.stats()).toMatchObject({ active: 0, waiting: 0, reservedBytes: 0 });
});

it('bounds queued job retention and resumes the existing queued work when capacity is released', async () => {
  const capacity = createEvidenceWorkerCapacity({ ...policy, maxQueuedJobs: 1 }, () => 0);
  const first = await capacity.acquire('preparation');
  const next = capacity.acquire('preparation');
  await expect(capacity.acquire('preparation')).rejects.toMatchObject({
    code: 'IMPORT_MEMORY_CAPACITY',
    reason: 'queue-full',
  });
  first.release();
  (await next).release();
  expect(capacity.stats().waiting).toBe(0);
});

it('does not reserve for already cancelled work', async () => {
  const capacity = createEvidenceWorkerCapacity(policy, () => 0);
  const controller = new AbortController();
  controller.abort();
  await expect(capacity.acquire('preparation', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(capacity.stats().active).toBe(0);
});

it('waits for a retained validator to release memory instead of mistaking it for idle pressure', async () => {
  let rss = 0;
  const capacity = createEvidenceWorkerCapacity(policy, () => rss);
  const validator = await capacity.acquire('preparation');
  validator.retainValidation();
  rss = 70;
  const started = vi.fn();
  const next = capacity.acquire('preparation').then((lease) => {
    started();
    return lease;
  });
  await Promise.resolve();
  expect(started).not.toHaveBeenCalled();
  expect(capacity.stats()).toMatchObject({ active: 1, preparing: 0, reservedBytes: 0, waiting: 1 });
  rss = 0;
  validator.release();
  (await next).release();
  expect(capacity.stats()).toMatchObject({ active: 0, preparing: 0, reservedBytes: 0, waiting: 0 });
});
