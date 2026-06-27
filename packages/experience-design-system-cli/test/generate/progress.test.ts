import { describe, expect, it } from 'vitest';
import { formatGenerateProgressLine } from '../../src/generate/progress.js';

describe('formatGenerateProgressLine', () => {
  it('formats a progress=generate completion line', () => {
    expect(formatGenerateProgressLine(1, 3, 'Button')).toBe('progress=generate:1/3:Button');
  });

  it('matches the wizard parser regex shape', () => {
    const line = formatGenerateProgressLine(5, 12, 'Modal');
    expect(line).toMatch(/^progress=generate:\d+\/\d+:.+$/);
  });

  it('produces monotonically increasing lines when completion order differs from input order', () => {
    // Simulate three components processed in completion order [2, 0, 1].
    // The emitted lines must count completions, not input positions.
    const completionOrder = [
      { name: 'C', total: 3 },
      { name: 'A', total: 3 },
      { name: 'B', total: 3 },
    ];
    const lines: string[] = [];
    let completed = 0;
    for (const c of completionOrder) {
      completed += 1;
      lines.push(formatGenerateProgressLine(completed, c.total, c.name));
    }
    expect(lines).toEqual(['progress=generate:1/3:C', 'progress=generate:2/3:A', 'progress=generate:3/3:B']);
  });
});
