import { displayValue } from './helpers.js';
import { formatParsedEdsiError } from './format-parsed-edsi-error.js';
import { parseEdsiError } from './parse-edsi-error.js';

export function formatEdsiError(raw: unknown, opts: { verbose?: boolean; raw?: string } = {}): string {
  const input = typeof raw === 'string' ? raw : displayValue(raw);
  if (!input) return '';
  return formatParsedEdsiError(parseEdsiError(input), { ...opts, raw: opts.raw ?? input });
}
