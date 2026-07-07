/**
 * Resolve the effective auto-filter setting from a CLI flag plus the persisted
 * config preference.
 *
 * Precedence (highest first):
 *   1. CLI flag (`--auto-filter` or `--no-auto-filter`) — wins when set
 *   2. Config (`credentials.json` `autoFilter` field) — used when flag absent
 *   3. Default ON — when neither is set
 */
import { getDebugLogger } from '../lib/debug-logger.js';

export function resolveAutoFilter(opts: { autoFilter?: boolean }, configAutoFilter?: boolean): boolean {
  const source = opts.autoFilter !== undefined ? 'flag' : configAutoFilter !== undefined ? 'config' : 'default';
  const value = opts.autoFilter ?? configAutoFilter ?? true;
  getDebugLogger().event('filter', 'auto-filter.resolve', { source, value });
  return value;
}
