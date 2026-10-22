import type { ImportTarget } from '../00-preflight/logic.js';
import { summarize, type FileCounts } from './scan-logic.js';

export type InputField = 'projectPath' | 'tokensPath';

export type InputValues = Record<InputField, string>;

/** The paths a mode asks for. A mode never shows the one it does not use. */
export function fieldsFor(target: ImportTarget): readonly InputField[] {
  if (target === 'tokens') return ['tokensPath'];
  if (target === 'components') return ['projectPath'];
  return ['projectPath', 'tokensPath'];
}

export function trimmed(value: string): string | null {
  const path = value.trim();
  return path === '' ? null : path;
}

/** The scan as one line, such as "167 files: 6 .tsx files · 100 .json files (design tokens)", and the warning if any. */
export function describeScan(counts: FileCounts, hasTokens: boolean): { line: string; warning?: string } {
  const { total, rows, warning } = summarize(counts, { hasTokens });
  const parts = rows.map((row) => `${row.count} ${row.label}`).join(' · ');
  return { line: `${total} files: ${parts}`, ...(warning ? { warning } : {}) };
}
