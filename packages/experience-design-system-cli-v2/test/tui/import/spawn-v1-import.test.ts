import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../../../src/tui/import/legacy-cli-path.js', () => ({
  findLegacyCliPath: () => '/fake/cli.js',
}));

import { spawnV1Import } from '../../../src/tui/import/spawn-v1-import.js';

describe('spawnV1Import stdin handling', () => {
  let child: EventEmitter;
  let pauseSpy: ReturnType<typeof vi.spyOn>;
  let resumeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    child = new EventEmitter();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child);
    pauseSpy = vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin);
    resumeSpy = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pauses stdin before spawning and resumes it after the child closes', async () => {
    const promise = spawnV1Import();

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(pauseSpy.mock.invocationCallOrder[0]).toBeLessThan(spawnMock.mock.invocationCallOrder[0]!);

    child.emit('close', 0);
    const result = await promise;

    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
  });

  it('resumes stdin when the child fails to spawn', async () => {
    const promise = spawnV1Import();

    child.emit('error', new Error('boom'));
    const result = await promise;

    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ exitCode: 1, stderr: 'boom' });
  });
});
