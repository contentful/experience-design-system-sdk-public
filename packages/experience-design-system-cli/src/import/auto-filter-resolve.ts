/**
 * Resolve the effective auto-filter setting from the persisted config
 * preference.
 *
 * Precedence (highest first):
 *   1. Config (`credentials.json` `autoFilter` field)
 *   2. Default ON — when config does not specify a preference
 */
import { getDebugLogger } from '../lib/debug-logger.js';

export function resolveAutoFilter(opts: { autoFilter?: boolean }, configAutoFilter?: boolean): boolean {
  const source = opts.autoFilter !== undefined ? 'flag' : configAutoFilter !== undefined ? 'config' : 'default';
  const value = opts.autoFilter ?? configAutoFilter ?? true;
  getDebugLogger().event('filter', 'auto-filter.resolve', { source, value });
  return value;
}
