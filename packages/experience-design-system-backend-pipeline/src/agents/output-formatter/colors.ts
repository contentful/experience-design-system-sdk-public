function detectColorSupport(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['FORCE_COLOR'] !== undefined) return true;
  return process.stderr.isTTY === true;
}

const colorsEnabled = detectColorSupport();

const wrap =
  (code: number) =>
  (text: string): string =>
    colorsEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;

export const ansi = {
  green: wrap(32),
  red: wrap(31),
  cyan: wrap(36),
  yellow: wrap(33),
  dim: wrap(2),
  bold: wrap(1),
};

// Backwards-compat alias — remove once callers migrate to `ansi`.
export const c = ansi;
