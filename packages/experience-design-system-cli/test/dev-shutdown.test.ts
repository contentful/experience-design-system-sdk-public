import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { stopChildAndWait } from '../scripts/dev-shutdown.mjs';

class Child extends EventEmitter {
  closed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    this.emit('exit', null, signal);
    return true;
  });
}

describe('dev shutdown', () => {
  it('sends SIGTERM and waits for child close after exit before resolving', async () => {
    const child = new Child();
    let settled = false;
    const stopped = stopChildAndWait(child).then(() => {
      settled = true;
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.exitCode = null;
    child.emit('exit', null, 'SIGTERM');
    await Promise.resolve();
    expect(settled).toBe(false);

    child.closed = true;
    child.emit('close', null, 'SIGTERM');
    await stopped;
    expect(settled).toBe(true);
  });

  it('does not signal a child that has already closed', async () => {
    const child = new Child();
    child.closed = true;

    await stopChildAndWait(child);

    expect(child.kill).not.toHaveBeenCalled();
  });
});
