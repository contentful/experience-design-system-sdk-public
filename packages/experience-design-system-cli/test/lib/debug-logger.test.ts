import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initDebugLogger,
  getDebugLogger,
  resolveDebugMode,
  redactForDebug,
  debugEnvForSubprocess,
  debugLogPath,
  __resetDebugLoggerForTest,
} from '../../src/lib/debug-logger.js';

let root: string;

beforeEach(() => {
  __resetDebugLoggerForTest();
  root = mkdtempSync(join(tmpdir(), 'edsi-debug-test-'));
  delete process.env['EDSI_DEBUG'];
  delete process.env['EDSI_DEBUG_LOG'];
  delete process.env['EDSI_DEBUG_ROOT'];
  delete process.env['EDSI_DEBUG_TS'];
});

afterEach(() => {
  __resetDebugLoggerForTest();
  rmSync(root, { recursive: true, force: true });
});

function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('resolveDebugMode', () => {
  it('prefers the CLI flag over env and config', () => {
    process.env['EDSI_DEBUG'] = '1';
    expect(resolveDebugMode({ debug: false }, true)).toBe(false);
    expect(resolveDebugMode({ debug: true }, false)).toBe(true);
  });

  it('falls through to env when flag is undefined', () => {
    process.env['EDSI_DEBUG'] = 'yes';
    expect(resolveDebugMode({}, false)).toBe(true);
    process.env['EDSI_DEBUG'] = 'off';
    expect(resolveDebugMode({}, true)).toBe(false);
  });

  it('uses persisted config when flag and env are absent', () => {
    expect(resolveDebugMode({}, true)).toBe(true);
    expect(resolveDebugMode({}, false)).toBe(false);
  });

  it('defaults to OFF when no source is set', () => {
    expect(resolveDebugMode({})).toBe(false);
  });
});

describe('redactForDebug', () => {
  it('redacts secret-shaped keys case-insensitively', () => {
    const out = redactForDebug({ cmaToken: 'CFPAT-abc', Authorization: 'Bearer xyz', name: 'Card' }) as Record<
      string,
      unknown
    >;
    expect(out['cmaToken']).toBe('«redacted»');
    expect(out['Authorization']).toBe('«redacted»');
    expect(out['name']).toBe('Card');
  });

  it('redacts token-shaped values under innocuous keys', () => {
    const out = redactForDebug({ note: 'here is CFPAT-abcdefghijklmnopqrstuvwx and stuff' }) as Record<
      string,
      unknown
    >;
    expect(out['note']).toBe('«redacted»');
  });

  it('handles arrays and nested objects', () => {
    const out = redactForDebug({ items: [{ password: 'p', name: 'n' }] }) as { items: Array<Record<string, unknown>> };
    expect(out.items[0]!['password']).toBe('«redacted»');
    expect(out.items[0]!['name']).toBe('n');
  });

  it('breaks cycles without throwing', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => redactForDebug(a)).not.toThrow();
  });
});

describe('initDebugLogger', () => {
  it('returns a no-op logger when disabled', () => {
    const logger = initDebugLogger({ enabled: false });
    expect(logger.enabled).toBe(false);
    expect(logger.path).toBeNull();
    logger.event('config', 'noop', { x: 1 }); // should not throw
  });

  it('writes JSONL events to a file when enabled', () => {
    process.env['EDSI_DEBUG_TS'] = '20260706T120000Z';
    const logger = initDebugLogger({ enabled: true, command: 'test', root });
    expect(logger.enabled).toBe(true);
    expect(logger.path).toBe(join(root, '20260706T120000Z-test.jsonl'));

    logger.event('agent', 'run.start', { model: 'sonnet-5' });
    logger.event('apply', 'preview.ok', { status: 200 });

    const lines = readLines(logger.path!);
    // session.open + command.start + 2 explicit events
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const names = lines.map((l) => l['name']);
    expect(names).toContain('session.open');
    expect(names).toContain('command.start');
    expect(names).toContain('run.start');
    expect(names).toContain('preview.ok');
  });

  it('redacts secrets on every event', () => {
    process.env['EDSI_DEBUG_TS'] = '20260706T120001Z';
    const logger = initDebugLogger({ enabled: true, command: 'test', root });
    logger.event('config', 'creds', { spaceId: 'sp', cmaToken: 'CFPAT-abcdef1234567890' });
    const lines = readLines(logger.path!);
    const match = lines.find((l) => l['name'] === 'creds');
    expect(match!['cmaToken']).toBe('«redacted»');
    expect(match!['spaceId']).toBe('sp');
  });

  it('joins an inherited EDSI_DEBUG_LOG when spawned as a subprocess', () => {
    process.env['EDSI_DEBUG_TS'] = '20260706T120002Z';
    const parent = initDebugLogger({ enabled: true, command: 'parent', root });
    const parentPath = parent.path!;
    __resetDebugLoggerForTest();
    process.env['EDSI_DEBUG_LOG'] = parentPath;
    // Child claims debug is disabled; inherited env should still win.
    const child = initDebugLogger({ enabled: false, command: 'child' });
    expect(child.enabled).toBe(true);
    expect(child.path).toBe(parentPath);
  });

  it('is idempotent — subsequent calls return the same instance', () => {
    process.env['EDSI_DEBUG_TS'] = '20260706T120003Z';
    const a = initDebugLogger({ enabled: true, command: 'a', root });
    const b = initDebugLogger({ enabled: true, command: 'b', root });
    expect(a).toBe(b);
  });
});

describe('debugEnvForSubprocess', () => {
  it('injects EDSI_DEBUG_LOG when the logger is active', () => {
    process.env['EDSI_DEBUG_TS'] = '20260706T120004Z';
    initDebugLogger({ enabled: true, command: 'parent', root });
    const env = debugEnvForSubprocess({ FOO: 'bar' });
    expect(env['EDSI_DEBUG_LOG']).toBe(debugLogPath());
    expect(env['FOO']).toBe('bar');
  });

  it('leaves the env untouched when the logger is disabled', () => {
    initDebugLogger({ enabled: false });
    const env = debugEnvForSubprocess({ FOO: 'bar' });
    expect(env['EDSI_DEBUG_LOG']).toBeUndefined();
  });
});

describe('getDebugLogger', () => {
  it('returns a no-op logger before init', () => {
    expect(getDebugLogger().enabled).toBe(false);
  });

  it('returns the active logger after init', () => {
    process.env['EDSI_DEBUG_TS'] = '20260706T120005Z';
    const logger = initDebugLogger({ enabled: true, command: 'x', root });
    expect(getDebugLogger()).toBe(logger);
    expect(existsSync(logger.path!)).toBe(true);
  });
});
