import { c } from './colors.js';

/** Formats a single parsed tool-call object into a human-readable line, or `null` to suppress. */
export function formatToolCall(obj: Record<string, unknown>): string | null {
  switch (obj['tool']) {
    case 'classify_component': {
      const desc = typeof obj['description'] === 'string' ? obj['description'] : null;
      return desc ? `    ${c.dim('→')}  ${c.dim(desc)}` : null;
    }
    case 'classify_prop': {
      const prop = String(obj['prop'] ?? '');
      const type = String(obj['cdf_type'] ?? '');
      const cat = String(obj['cdf_category'] ?? '');
      return `    ${c.green('+')}  ${prop}  ${c.dim(`${type}  ${cat}`)}`;
    }
    case 'exclude_prop': {
      const prop = String(obj['prop'] ?? '');
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
      return `    ${c.dim('–')}  ${prop}  ${c.dim(reason)}`;
    }
    case 'classify_slot': {
      const slot = String(obj['slot'] ?? '');
      const desc = typeof obj['description'] === 'string' ? obj['description'] : '';
      const req = obj['required'] === true ? c.dim(' required') : '';
      return `    ${c.cyan('◈')}  ${slot}${req}  ${c.dim(desc)}`;
    }
    case 'select_component': {
      const name = String(obj['name'] ?? '');
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
      return `    ${c.green('+')}  ${name}  ${c.dim(reason)}`;
    }
    case 'reject_component': {
      const name = String(obj['name'] ?? '');
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
      return `    ${c.dim('–')}  ${name}  ${c.dim(reason)}`;
    }
    default:
      return null;
  }
}
