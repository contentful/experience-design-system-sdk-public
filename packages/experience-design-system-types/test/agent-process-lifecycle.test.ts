import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentCancellationResult, runAgentProcess } from '../src/index.js';

function createChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return child;
}

describe('shared agent process lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves output and debug settlement when no signal is supplied', async () => {
    const child = createChild();
    const onOutput = vi.fn();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const promise = runAgentProcess({
      spawn: () => child as never,
      timeoutMs: 10_000,
      onOutput,
      onStart,
      onEnd,
    });

    child.stdout.write('visible');
    child.stderr.write('diagnostic');
    child.emit('close', 0, null);

    await expect(promise).resolves.toEqual({
      exitCode: 0,
      stdout: 'visible',
      stderr: 'diagnostic',
      timedOut: false,
    });
    expect(onOutput).toHaveBeenCalledExactlyOnceWith('visible');
    expect(onStart).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('returns cancellation before spawn, timer, or debug activity for a pre-aborted signal', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const spawn = vi.fn();
    const onStart = vi.fn();
    const onEnd = vi.fn();

    await expect(runAgentProcess({ spawn, timeoutMs: 10, signal: controller.signal, onStart, onEnd })).resolves.toEqual(
      createAgentCancellationResult(),
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates on active abort, keeps diagnostics, and suppresses trailing presentation output', async () => {
    const child = createChild();
    const controller = new AbortController();
    const onOutput = vi.fn();
    const promise = runAgentProcess({
      spawn: () => child as never,
      timeoutMs: 10_000,
      signal: controller.signal,
      stdinText: 'prompt',
      onOutput,
    });

    child.stdout.write('before abort');
    controller.abort();
    child.stdout.write('after abort');
    child.stderr.write('child diagnostic');
    child.emit('close', 0, null);

    await expect(promise).resolves.toEqual({
      exitCode: 1,
      stdout: 'before abortafter abort',
      stderr: 'child diagnostic',
      timedOut: false,
    });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(child.stdin.writableEnded).toBe(true);
    expect(onOutput).toHaveBeenCalledExactlyOnceWith('before abort');
  });

  it('catches an abort during spawn before listener registration and skips stdin delivery', async () => {
    const child = createChild();
    const controller = new AbortController();
    const input: string[] = [];
    child.stdin.on('data', (chunk) => input.push(chunk.toString()));
    const promise = runAgentProcess({
      spawn: () => {
        controller.abort();
        return child as never;
      },
      timeoutMs: 10_000,
      signal: controller.signal,
      stdinText: 'prompt',
    });

    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(input).toEqual([]);
    child.emit('close', 0, null);
    await expect(promise).resolves.toMatchObject({ exitCode: 1, timedOut: false });
  });

  it('waits for close after child error and reports the error once', async () => {
    vi.useFakeTimers();
    const child = createChild();
    const onEnd = vi.fn();
    const promise = runAgentProcess({ spawn: () => child as never, timeoutMs: 100, onEnd });

    child.emit('error', new Error('spawn failed'));
    expect(onEnd).not.toHaveBeenCalled();
    child.emit('close', null, null);

    await expect(promise).resolves.toMatchObject({ exitCode: 1, stderr: 'spawn failed', timedOut: false });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a synchronous spawn exception into one failed result and debug end', async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const result = await runAgentProcess({
      spawn: () => {
        throw new Error('spawn threw');
      },
      timeoutMs: 100,
      onStart,
      onEnd,
    });

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'spawn threw', timedOut: false });
    expect(onStart).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('preserves trailing presentation output after timeout when no signal is supplied', async () => {
    vi.useFakeTimers();
    const child = createChild();
    const onOutput = vi.fn();
    const promise = runAgentProcess({ spawn: () => child as never, timeoutMs: 25, onOutput });

    child.stdout.write('before timeout');
    await vi.advanceTimersByTimeAsync(25);
    child.stdout.write('after timeout');
    child.emit('close', null, 'SIGTERM');

    await expect(promise).resolves.toEqual({
      exitCode: 1,
      stdout: 'before timeoutafter timeout',
      stderr: '',
      timedOut: true,
    });
    expect(onOutput.mock.calls).toEqual([['before timeout'], ['after timeout']]);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('suppresses presentation only after abort when timeout was the first stop reason', async () => {
    vi.useFakeTimers();
    const child = createChild();
    const controller = new AbortController();
    const onOutput = vi.fn();
    const promise = runAgentProcess({
      spawn: () => child as never,
      timeoutMs: 25,
      signal: controller.signal,
      onOutput,
    });

    await vi.advanceTimersByTimeAsync(25);
    child.stdout.write('after timeout');
    controller.abort();
    child.stdout.write('after abort');
    child.emit('close', 0, null);

    await expect(promise).resolves.toMatchObject({
      exitCode: 1,
      stdout: 'after timeoutafter abort',
      timedOut: true,
    });
    expect(onOutput).toHaveBeenCalledExactlyOnceWith('after timeout');
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the first stop reason when timeout, abort, and zero exit race', async () => {
    vi.useFakeTimers();
    const child = createChild();
    const controller = new AbortController();
    const promise = runAgentProcess({
      spawn: () => child as never,
      timeoutMs: 25,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(25);
    controller.abort();
    child.emit('close', 0, null);

    await expect(promise).resolves.toMatchObject({ exitCode: 1, timedOut: true });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps abort as the first stop reason and waits for close to settle', async () => {
    vi.useFakeTimers();
    const child = createChild();
    const controller = new AbortController();
    let settled = false;
    const promise = runAgentProcess({
      spawn: () => child as never,
      timeoutMs: 25,
      signal: controller.signal,
    }).then((result) => {
      settled = true;
      return result;
    });

    controller.abort();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(25);
    expect(settled).toBe(false);
    child.emit('close', 0, null);

    await expect(promise).resolves.toMatchObject({ exitCode: 1, timedOut: false });
    expect(settled).toBe(true);
  });

  it('removes the abort listener after close so a late abort has no effect', async () => {
    const child = createChild();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = runAgentProcess({
      spawn: () => child as never,
      timeoutMs: 10_000,
      signal: controller.signal,
    });

    child.emit('close', 0, null);
    await expect(promise).resolves.toMatchObject({ exitCode: 0 });
    controller.abort();

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(child.kill).not.toHaveBeenCalled();
  });
});
