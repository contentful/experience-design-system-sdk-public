import { describe, expect, it } from 'vitest';
import { OutputFormatter } from '../output-formatter/output-formatter.js';

describe('OutputFormatter', () => {
  it('formats tool-call JSON lines into human-readable summaries', () => {
    let out = '';
    const formatter = new OutputFormatter(false, (s) => {
      out += s;
    });
    formatter.push(
      JSON.stringify({ tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' }) + '\n',
    );
    expect(out).toContain('label');
    expect(out).toContain('string');
  });

  it('suppresses prose lines in non-verbose mode', () => {
    let out = '';
    const formatter = new OutputFormatter(false, (s) => {
      out += s;
    });
    formatter.push('just thinking out loud\n');
    expect(out).toBe('');
  });

  it('emits prose lines in verbose mode', () => {
    let out = '';
    const formatter = new OutputFormatter(true, (s) => {
      out += s;
    });
    formatter.push('reasoning line\n');
    expect(out).toContain('reasoning line');
  });

  it('flush processes a trailing partial line', () => {
    let out = '';
    const formatter = new OutputFormatter(true, (s) => {
      out += s;
    });
    formatter.push('partial'); // no newline
    expect(out).toBe('');
    formatter.flush();
    expect(out).toContain('partial');
  });
});
