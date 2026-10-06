import { describe, it, expect, vi } from 'vitest';
import { retryDatabaseWrite } from '../../../src/analyze/helpers/retry-db-write.js';

describe('retryDatabaseWrite', () => {
  it('returns immediately on success', async () => {
    const op = vi.fn().mockReturnValue(42);
    const result = await retryDatabaseWrite(op);
    expect(result).toBe(42);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on database locked error', async () => {
    const op = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('database is locked');
      })
      .mockReturnValue('ok');
    const result = await retryDatabaseWrite(op);
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('retries on database is busy error', async () => {
    const op = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('database is busy');
      })
      .mockReturnValue('done');
    const result = await retryDatabaseWrite(op);
    expect(result).toBe('done');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-locking errors', async () => {
    const op = vi.fn().mockImplementation(() => {
      throw new Error('syntax error');
    });
    await expect(retryDatabaseWrite(op)).rejects.toThrow('syntax error');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting attempts', async () => {
    const op = vi.fn().mockImplementation(() => {
      throw new Error('database is locked');
    });
    await expect(retryDatabaseWrite(op, 3)).rejects.toThrow('database is locked');
    expect(op).toHaveBeenCalledTimes(3);
  });
});
