import { readFileSync } from 'node:fs';
import { flattenTokens, type TokenRow } from './logic.js';

export function loadTokenRows(tokensPath: string): { ok: true; rows: TokenRow[] } | { ok: false; message: string } {
  try {
    return { ok: true, rows: flattenTokens(JSON.parse(readFileSync(tokensPath, 'utf8'))) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
