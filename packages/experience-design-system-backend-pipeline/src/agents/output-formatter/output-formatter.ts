import { c } from './colors.js';
import { formatToolCall } from './format-tool-call.js';

/**
 * Processes streaming agent output line by line. Tool-call JSON lines become
 * human-readable summaries; prose (reasoning text) only renders in verbose
 * mode.
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
