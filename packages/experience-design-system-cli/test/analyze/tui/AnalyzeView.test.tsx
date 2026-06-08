import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { AnalyzeView } from '../../../src/analyze/tui/AnalyzeView.js';
import type { AnalyzeViewResult } from '../../../src/analyze/tui/AnalyzeView.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const result: AnalyzeViewResult = {
  sourceDirectory: '/project/src',
  sessionId: 'test-session-abc123',
  fileCount: 42,
  components: [
    {
      name: 'Button',
      framework: 'react',
      propCount: 5,
      slotCount: 1,
      warnings: [],
      extractionConfidence: 95,
      needsReview: false,
    },
    {
      name: 'Input',
      framework: 'react',
      propCount: 3,
      slotCount: 0,
      warnings: ['prop onChange has inferred type any'],
      extractionConfidence: 55,
      needsReview: true,
    },
  ],
  totalWarnings: 1,
};

describe('AnalyzeView', () => {
  it('renders file count and component count', () => {
    const { lastFrame } = render(<AnalyzeView result={result} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('42');
    expect(frame).toContain('Button');
    expect(frame).toContain('Input');
  });

  it('renders warning section when warnings present', () => {
    const { lastFrame } = render(<AnalyzeView result={result} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Warnings');
    expect(frame).toContain('⚠');
  });

  it('calls onExit when q is pressed', async () => {
    const onExit = vi.fn();
    const { stdin } = render(<AnalyzeView result={result} onExit={onExit} />);
    stdin.write('q');
    await new Promise((r) => setTimeout(r, 30));
    expect(onExit).toHaveBeenCalled();
  });

  it('does not render warning section when no warnings', () => {
    const noWarnResult: AnalyzeViewResult = {
      ...result,
      components: result.components.map((c) => ({ ...c, warnings: [] })),
      totalWarnings: 0,
    };
    const { lastFrame } = render(<AnalyzeView result={noWarnResult} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Warnings (');
  });

  it('matches snapshot with no warnings', () => {
    const noWarnResult: AnalyzeViewResult = {
      ...result,
      components: result.components.map((c) => ({ ...c, warnings: [] })),
      totalWarnings: 0,
    };
    const { lastFrame } = render(<AnalyzeView result={noWarnResult} onExit={vi.fn()} />);
    expect(stripAnsi(lastFrame() ?? '')).toMatchSnapshot();
  });

  it('matches snapshot with warnings', () => {
    const { lastFrame } = render(<AnalyzeView result={result} onExit={vi.fn()} />);
    expect(stripAnsi(lastFrame() ?? '')).toMatchSnapshot();
  });
});
