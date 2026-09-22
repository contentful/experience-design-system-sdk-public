import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { die } from '../../src/lib/cli-errors.js';
import { __resetDebugLoggerForTest, initDebugLogger } from '../../src/lib/debug-logger.js';

vi.mock('../../src/analytics/index.js', () => ({
  exitWithAnalytics: vi.fn(async () => undefined),
}));

describe('die', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'edsi-die-test-'));
    __resetDebugLoggerForTest();
  });

  afterEach(() => {
    __resetDebugLoggerForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it('records the failure in debug mode without changing the thrown error', () => {
    const logger = initDebugLogger({ enabled: true, root, command: 'test' });

    expect(() => die('Error: something failed')).toThrow('exit');

    const records = readFileSync(logger.path!, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toContainEqual(
      expect.objectContaining({
        category: 'other',
        name: 'cli.die',
        message: 'Error: something failed',
      }),
    );
  });
});
