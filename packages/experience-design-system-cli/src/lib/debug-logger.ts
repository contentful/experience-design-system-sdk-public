import { mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ── Public types ─────────────────────────────────────────────────────────────

export type DebugCategory =
  | 'config'
  | 'agent'
  | 'apply'
  | 'import'
  | 'analyze'
  | 'filter'
  | 'session'
  | 'runs'
  | 'tui'
  | 'wizard'
  | 'setup'
  | 'output'
  | 'other';

export interface DebugLogger {
  readonly enabled: boolean;
  readonly path: string | null;
  event(category: DebugCategory, name: string, payload?: Record<string, unknown>): void;
}

// ── Redaction ────────────────────────────────────────────────────────────────

// Blocklist of secret-shaped keys; matched case-insensitively.
const SECRET_KEY_PATTERNS: RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /^auth$/i,
  /apikey/i,
  /api_key/i,
  /credential/i,
  /bearer/i,
  /^cma$/i,
  /cmaToken/i,
];

// Value-side patterns for strings that look like tokens even under innocuous keys.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /^Bearer\s+\S+/i,
  /CFPAT-[A-Za-z0-9_-]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
];

const REDACTED = '«redacted»';
const MAX_STRING_LEN = 4000;

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((r) => r.test(value))) return REDACTED;
    return value.length > MAX_STRING_LEN
      ? value.slice(0, MAX_STRING_LEN) + `…«+${value.length - MAX_STRING_LEN}»`
      : value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '«cycle»';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_PATTERNS.some((r) => r.test(k))) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, seen);
    }
  }
  return out;
}

export function redactForDebug(payload: unknown): unknown {
  return redactValue(payload, new WeakSet());
}

// ── Path resolution ──────────────────────────────────────────────────────────

const DEBUG_ROOT_ENV = 'EDSI_DEBUG_ROOT';
const DEBUG_LOG_ENV = 'EDSI_DEBUG_LOG';

function defaultDebugRoot(): string {
  return process.env[DEBUG_ROOT_ENV] ?? join(homedir(), '.contentful', 'experience-design-system-cli', 'debug');
}

// Session timestamp source. Deterministic-friendly: honors EDSI_DEBUG_TS for tests.
function makeSessionTimestamp(): string {
  const override = process.env['EDSI_DEBUG_TS'];
  if (override) return override;
  const now = new Date();
  const pad = (n: number, w = 2): string => n.toString().padStart(w, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

// ── Singleton ───────────────────────────────────────────────────────────────

let singleton: DebugLogger | null = null;

class NoopDebugLogger implements DebugLogger {
  readonly enabled = false;
  readonly path = null;
  event(): void {
    /* no-op */
  }
}

class FileDebugLogger implements DebugLogger {
  readonly enabled = true;
  readonly path: string;
  private readonly sessionStart: number;

  constructor(path: string) {
    this.path = path;
    this.sessionStart = Date.now();
    mkdirSync(dirname(path), { recursive: true });
    // Header event — records the process context.
    this.write({
      ts: new Date().toISOString(),
      category: 'config',
      name: 'session.open',
      pid: process.pid,
      ppid: process.ppid,
      cwd: process.cwd(),
      argv: process.argv.slice(1),
      node: process.version,
      platform: process.platform,
    });
  }

  event(category: DebugCategory, name: string, payload: Record<string, unknown> = {}): void {
    const redacted = redactForDebug(payload) as Record<string, unknown>;
    this.write({
      ts: new Date().toISOString(),
      elapsedMs: Date.now() - this.sessionStart,
      category,
      name,
      pid: process.pid,
      ...redacted,
    });
  }

  private write(record: Record<string, unknown>): void {
    try {
      appendFileSync(this.path, JSON.stringify(record) + '\n', { encoding: 'utf8' });
    } catch {
      // Debug logging must never crash the CLI. Swallow.
    }
  }
}

export interface InitDebugLoggerOptions {
  /** Effective on/off decision (flag > env > config, resolved by caller). */
  enabled: boolean;
  /** Command name — recorded in the session-open event for filtering. */
  command?: string;
  /** Override log root (defaults to ~/.contentful/experience-design-system-cli/debug/). */
  root?: string;
}

/**
 * Initialize the process-wide debug logger. Safe to call multiple times —
 * subsequent calls return the existing instance.
 *
 * If EDSI_DEBUG_LOG is already set in the environment, this process joins
 * that log file (used by spawned subprocesses so a whole `experiences import`
 * flow lands in a single file).
 */
export function initDebugLogger(opts: InitDebugLoggerOptions): DebugLogger {
  if (singleton) return singleton;

  // Inherited from parent process — always join the existing file, regardless
  // of the local flag/env decision. Parent already made the choice.
  const inherited = process.env[DEBUG_LOG_ENV];
  if (inherited) {
    singleton = new FileDebugLogger(inherited);
    if (opts.command) singleton.event('config', 'subprocess.start', { command: opts.command });
    return singleton;
  }

  if (!opts.enabled) {
    singleton = new NoopDebugLogger();
    return singleton;
  }

  const root = opts.root ?? defaultDebugRoot();
  const ts = makeSessionTimestamp();
  const suffix = opts.command ? `-${opts.command}` : '';
  const path = join(root, `${ts}${suffix}.jsonl`);

  singleton = new FileDebugLogger(path);
  process.env[DEBUG_LOG_ENV] = path; // propagate to spawned children

  if (opts.command) singleton.event('config', 'command.start', { command: opts.command });

  // Emit a close event on process exit. Best-effort — writeFileSync-based, so
  // it works from within an 'exit' handler.
  process.on('exit', (code) => {
    if (singleton && singleton.enabled) {
      singleton.event('config', 'session.close', { exitCode: code });
    }
  });

  return singleton;
}

export function getDebugLogger(): DebugLogger {
  return singleton ?? new NoopDebugLogger();
}

/** Test-only: reset the singleton. */
export function __resetDebugLoggerForTest(): void {
  singleton = null;
  delete process.env[DEBUG_LOG_ENV];
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve effective debug-mode setting from three sources.
 *
 * Precedence (highest first):
 *   1. `--debug` / `--no-debug` CLI flag
 *   2. `EDSI_DEBUG` env var (truthy: 1, true, yes, on)
 *   3. Persisted `debug` field in credentials.json
 *   4. Default: OFF
 */
export function resolveDebugMode(opts: { debug?: boolean }, configDebug?: boolean): boolean {
  if (opts.debug !== undefined) return opts.debug;
  const env = process.env['EDSI_DEBUG'];
  if (env !== undefined && env !== '') {
    const v = env.toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  }
  if (configDebug !== undefined) return configDebug;
  return false;
}

// ── Bright-green banner ─────────────────────────────────────────────────────

/**
 * Emit the bright-green "debug logs at <path>" banner to stderr.
 * No-op when debug is disabled or stderr is not a TTY-friendly stream.
 * Callers should invoke this once at start and once at end of the command.
 */
export function printDebugBanner(logger: DebugLogger, phase: 'start' | 'end'): void {
  if (!logger.enabled || !logger.path) return;
  const prefix = phase === 'start' ? '\x1b[92m[debug]\x1b[0m ' : '\x1b[92m[debug]\x1b[0m ';
  const label = phase === 'start' ? 'debug logs at' : 'debug logs written to';
  // Bright green (92) + bold (1); reset with 0.
  const line = `${prefix}\x1b[1m\x1b[92m${label} ${logger.path}\x1b[0m\n`;
  try {
    process.stderr.write(line);
  } catch {
    /* ignore */
  }
}

/** Directory that contains the current process's debug log, if any. */
export function debugLogPath(): string | null {
  return singleton?.path ?? process.env[DEBUG_LOG_ENV] ?? null;
}

/** Ensure spawned children join the same debug log by including EDSI_DEBUG_LOG in their env. */
export function debugEnvForSubprocess(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const path = debugLogPath();
  if (!path) return env;
  return { ...env, [DEBUG_LOG_ENV]: path };
}
