import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { AnalyzeView } from '../../../src/analyze/tui/AnalyzeView.js';
import type { AnalyzeViewResult } from '../../../src/analyze/tui/AnalyzeView.js';

// Strip ANSI escapes AND the package version so snapshots survive release bumps.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/v\d+\.\d+\.\d+/g, 'v<version>');

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
      errors: [],
      extractionConfidence: 95,
      needsReview: false,
    },
    {
      name: 'Input',
      framework: 'react',
      propCount: 3,
      slotCount: 0,
      warnings: ['prop onChange has inferred type any'],
      errors: [],
      extractionConfidence: 55,
      needsReview: true,
    },
  ],
  totalWarnings: 1,
  totalErrors: 0,
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

describe('AnalyzeView — error tier', () => {
  // Errors must be visible at extract time so the user knows which components
  // will be auto-rejected at the next step. Without this, AnalyzeView shows
  // only a count + warnings, and the error-severity finding is invisible
  // until the user runs `analyze select`.
  const errorResult: AnalyzeViewResult = {
    sourceDirectory: '/project/src',
    sessionId: 'sess-err',
    fileCount: 3,
    components: [
      {
        name: 'BadSlot',
        framework: 'vue',
        propCount: 1,
        slotCount: 2,
        warnings: [],
        errors: ['Slot at index 0 has an empty name'],
        extractionConfidence: 4,
        needsReview: false,
      },
      {
        name: 'Empty',
        framework: 'react',
        propCount: 0,
        slotCount: 0,
        warnings: ['Empty: no props or slots'],
        errors: [],
        extractionConfidence: 4,
        needsReview: false,
      },
      {
        name: 'Good',
        framework: 'react',
        propCount: 2,
        slotCount: 0,
        warnings: [],
        errors: [],
        extractionConfidence: 4,
        needsReview: false,
      },
    ],
    totalWarnings: 1,
    totalErrors: 1,
  };

  it('renders the Errors section header with the count', () => {
    const { lastFrame } = render(<AnalyzeView result={errorResult} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Errors (1)');
  });

  it('renders the per-error message text in the Errors section', () => {
    const { lastFrame } = render(<AnalyzeView result={errorResult} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('BadSlot: Slot at index 0 has an empty name');
  });

  it('renders a ✗ badge on the row of a component with errors', () => {
    const { lastFrame } = render(<AnalyzeView result={errorResult} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    // The badge appears on BadSlot's component row (not just inside the
    // Errors section). The simplest cross-row check: ✗ appears at least twice
    // (once on the row, once in the Errors section).
    const xCount = (frame.match(/✗/g) ?? []).length;
    expect(xCount).toBeGreaterThanOrEqual(2);
  });

  it('does not render Errors section when totalErrors is 0', () => {
    const { lastFrame } = render(<AnalyzeView result={result} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Errors (');
  });

  it('renders both Errors and Warnings sections when both are present', () => {
    const { lastFrame } = render(<AnalyzeView result={errorResult} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Errors (1)');
    expect(frame).toContain('Warnings (1)');
  });
});
