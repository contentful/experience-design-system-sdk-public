function detectColors(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['FORCE_COLOR'] !== undefined) return true;
  return process.stderr.isTTY === true;
}

const col = detectColors();

export const c = {
  green: (s: string) => (col ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (col ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (col ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string) => (col ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (col ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (col ? `\x1b[1m${s}\x1b[0m` : s),
};
