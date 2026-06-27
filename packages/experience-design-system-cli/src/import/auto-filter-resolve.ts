/**
 * Resolve the effective auto-filter setting from a CLI flag plus the persisted
 * config preference.
 *
 * Precedence (highest first):
 *   1. CLI flag (`--auto-filter` or `--no-auto-filter`) — wins when set
 *   2. Config (`credentials.json` `autoFilter` field) — used when flag absent
 *   3. Default ON — when neither is set
 */
export function resolveAutoFilter(opts: { autoFilter?: boolean }, configAutoFilter?: boolean): boolean {
  if (opts.autoFilter !== undefined) return opts.autoFilter;
  if (configAutoFilter !== undefined) return configAutoFilter;
  return true;
}
