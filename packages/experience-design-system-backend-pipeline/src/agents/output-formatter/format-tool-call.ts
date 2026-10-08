import { ansi } from './colors.js';

/** Formats a single parsed tool-call object into a human-readable line, or `null` to suppress. */
export function formatToolCall(obj: Record<string, unknown>): string | null {
  switch (obj['tool']) {
    case 'classify_component': {
      const desc = typeof obj['description'] === 'string' ? obj['description'] : null;
      return desc ? `    ${ansi.dim('→')}  ${ansi.dim(desc)}` : null;
    }
    case 'classify_prop': {
      const prop = String(obj['prop'] ?? '');
      const type = String(obj['cdf_type'] ?? '');
      const cat = String(obj['cdf_category'] ?? '');
      return `    ${ansi.green('+')}  ${prop}  ${ansi.dim(`${type}  ${cat}`)}`;
    }
    case 'exclude_prop': {
      const prop = String(obj['prop'] ?? '');
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
      return `    ${ansi.dim('–')}  ${prop}  ${ansi.dim(reason)}`;
    }
    case 'classify_slot': {
      const slot = String(obj['slot'] ?? '');
      const desc = typeof obj['description'] === 'string' ? obj['description'] : '';
      const req = obj['required'] === true ? ansi.dim(' required') : '';
      return `    ${ansi.cyan('◈')}  ${slot}${req}  ${ansi.dim(desc)}`;
    }
    case 'select_component': {
      const name = String(obj['name'] ?? '');
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
      return `    ${ansi.green('+')}  ${name}  ${ansi.dim(reason)}`;
    }
    case 'reject_component': {
      const name = String(obj['name'] ?? '');
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
      return `    ${ansi.dim('–')}  ${name}  ${ansi.dim(reason)}`;
    }
    default:
      return null;
  }
}
