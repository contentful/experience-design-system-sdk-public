import type { ParsedTokenToolCalls, SetTokenCall, SetGroupCall } from '../../types/tool-calls.js';
import { readToolCallObjects } from './helpers/read-tool-call-objects.js';

const VALID_TOKEN_TOOL_NAMES = new Set(['set_token', 'set_group']);

export function parseTokenToolCallLines(stdout: string): ParsedTokenToolCalls {
  const calls: Array<SetTokenCall | SetGroupCall> = [];
  const { objects, warnings } = readToolCallObjects(stdout);

  for (const rec of objects) {
    if (!VALID_TOKEN_TOOL_NAMES.has(rec.tool as string)) continue;

    if (rec.tool === 'set_token') {
      if (typeof rec.path !== 'string' || !rec.path) {
        warnings.push('set_token missing path — skipped');
        continue;
      }
      if (typeof rec.type !== 'string' || !rec.type) {
        warnings.push(`set_token '${rec.path}': missing type — skipped`);
        continue;
      }
      if (!('value' in rec)) {
        warnings.push(`set_token '${rec.path}': missing value — skipped`);
        continue;
      }
      const call: SetTokenCall = {
        tool: 'set_token',
        path: rec.path,
        type: rec.type,
        value: rec.value,
      };
      if (typeof rec.description === 'string') call.description = rec.description;
      calls.push(call);
    } else if (rec.tool === 'set_group') {
      if (typeof rec.path !== 'string' || !rec.path) {
        warnings.push('set_group missing path — skipped');
        continue;
      }
      const call: SetGroupCall = { tool: 'set_group', path: rec.path };
      if (typeof rec.description === 'string') call.description = rec.description;
      calls.push(call);
    }
  }

  return { calls, warnings };
}
