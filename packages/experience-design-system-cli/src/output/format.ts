// Color support — checked once at module load.
// Honors NO_COLOR (https://no-color.org) and FORCE_COLOR (set by orchestrator for non-TTY subprocesses).
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

// Formats a single parsed tool-call object into a human-readable line, or returns null to suppress it.
function formatToolCall(obj: Record<string, unknown>): string | null {
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

/**
 * Processes streaming agent output line by line.
 *
 * Tool-call JSON lines are translated into human-readable summaries.
 * Prose (reasoning text) is shown only when verbose=true.
 */
export class OutputFormatter {
  private _buf = '';
  private _verbose: boolean;
  private _write: (s: string) => void;

  constructor(verbose: boolean, write: (s: string) => void = (s) => process.stderr.write(s)) {
    this._verbose = verbose;
    this._write = write;
  }

  push(chunk: string): void {
    this._buf += chunk;
    // Process all complete lines; keep any trailing partial line in the buffer.
    const nl = this._buf.lastIndexOf('\n');
    if (nl === -1) return;
    const complete = this._buf.slice(0, nl + 1);
    this._buf = this._buf.slice(nl + 1);
    for (const line of complete.split('\n')) {
      this._processLine(line);
    }
  }

  flush(): void {
    if (this._buf.trim()) this._processLine(this._buf);
    this._buf = '';
  }

  private _processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof obj['tool'] === 'string') {
          const formatted = formatToolCall(obj);
          if (formatted !== null) this._write(formatted + '\n');
          return;
        }
      } catch {
        // not JSON — fall through to prose handling
      }
    }

    if (this._verbose) {
      this._write(c.dim('    ' + trimmed) + '\n');
    }
  }
}
