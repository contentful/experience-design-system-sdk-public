import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutputFormatter } from '../../src/output/format.js';

// Helpers to strip ANSI escape codes so tests are color-agnostic.
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Force colors off for predictable test output.
beforeEach(() => {
  process.env['NO_COLOR'] = '1';
  delete process.env['FORCE_COLOR'];
});
afterEach(() => {
  delete process.env['NO_COLOR'];
});

// ── OutputFormatter ───────────────────────────────────────────────────────────

describe('OutputFormatter — tool-call lines', () => {
  it('formats classify_prop as a visible + line', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content"}\n');
    f.flush();
    expect(lines).toHaveLength(1);
    const out = strip(lines[0]!);
    expect(out).toContain('+');
    expect(out).toContain('label');
    expect(out).toContain('string');
    expect(out).toContain('content');
  });

  it('formats exclude_prop as a visible – line', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('{"tool":"exclude_prop","prop":"className","reason":"framework internal"}\n');
    f.flush();
    expect(lines).toHaveLength(1);
    const out = strip(lines[0]!);
    expect(out).toContain('–');
    expect(out).toContain('className');
    expect(out).toContain('framework internal');
  });

  it('formats classify_slot as a visible ◈ line', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('{"tool":"classify_slot","slot":"default","required":true,"description":"primary content"}\n');
    f.flush();
    const out = strip(lines[0]!);
    expect(out).toContain('◈');
    expect(out).toContain('default');
    expect(out).toContain('primary content');
  });

  it('suppresses classify_component with no description', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('{"tool":"classify_component"}\n');
    f.flush();
    expect(lines).toHaveLength(0);
  });

  it('shows classify_component description when present', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('{"tool":"classify_component","description":"A button component"}\n');
    f.flush();
    expect(lines).toHaveLength(1);
    expect(strip(lines[0]!)).toContain('A button component');
  });
});

describe('OutputFormatter — prose suppression', () => {
  it('hides prose in non-verbose mode', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('This is some agent reasoning text\n');
    f.push('Another line of thinking\n');
    f.flush();
    expect(lines).toHaveLength(0);
  });

  it('shows prose in verbose mode', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(true, (s) => lines.push(s));
    f.push('Some reasoning text\n');
    f.flush();
    expect(lines).toHaveLength(1);
    expect(strip(lines[0]!)).toContain('Some reasoning text');
  });
});

describe('OutputFormatter — chunking', () => {
  it('buffers partial lines across pushes', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    // Send half a JSON line then the rest
    f.push('{"tool":"exclude_pro');
    // Nothing emitted yet
    expect(lines).toHaveLength(0);
    f.push('p","prop":"foo","reason":"bar"}\n');
    expect(lines).toHaveLength(1);
    expect(strip(lines[0]!)).toContain('foo');
  });

  it('handles multiple lines in a single push', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push(
      '{"tool":"classify_prop","prop":"a","cdf_type":"string","cdf_category":"content"}\n' +
        '{"tool":"exclude_prop","prop":"b","reason":"internal"}\n',
    );
    f.flush();
    expect(lines).toHaveLength(2);
  });

  it('flushes remaining buffer content', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('{"tool":"exclude_prop","prop":"x","reason":"test"}'); // no trailing newline
    expect(lines).toHaveLength(0);
    f.flush();
    expect(lines).toHaveLength(1);
    expect(strip(lines[0]!)).toContain('x');
  });

  it('ignores non-JSON lines silently', () => {
    const lines: string[] = [];
    const f = new OutputFormatter(false, (s) => lines.push(s));
    f.push('not json at all\n');
    f.push('also not: {broken json\n');
    f.flush();
    expect(lines).toHaveLength(0);
  });
});
