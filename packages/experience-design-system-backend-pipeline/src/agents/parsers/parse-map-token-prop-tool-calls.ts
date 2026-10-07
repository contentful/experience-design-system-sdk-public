import type { MapTokenPropCall, ParsedMapTokenPropToolCalls } from '../types/tool-calls.js';
import { isStringArray } from './helpers/is-string-array.js';

export function parseMapTokenPropToolCalls(stdout: string): ParsedMapTokenPropToolCalls {
  const calls: MapTokenPropCall[] = [];
  const warnings: string[] = [];

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      warnings.push(`unparseable line: ${line.slice(0, 120)}`);
      continue;
    }

    if (typeof obj !== 'object' || obj === null || !('tool' in obj)) continue;
    const rec = obj as Record<string, unknown>;
    if (rec.tool !== 'map_token_prop') continue;

    if (typeof rec.component !== 'string' || !rec.component) {
      warnings.push('map_token_prop missing component — skipped');
      continue;
    }
    if (typeof rec.prop !== 'string' || !rec.prop) {
      warnings.push(`map_token_prop '${rec.component}': missing prop — skipped`);
      continue;
    }
    if (!isStringArray(rec.token_allowed) || rec.token_allowed.length === 0) {
      warnings.push(`map_token_prop '${rec.component}.${String(rec.prop)}': missing or empty token_allowed — skipped`);
      continue;
    }

    calls.push({
      tool: 'map_token_prop',
      component: rec.component,
      prop: rec.prop,
      token_allowed: rec.token_allowed,
    });
  }

  return { calls, warnings };
}
