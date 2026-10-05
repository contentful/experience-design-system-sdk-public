import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { ValidateView } from '../../../../src/print/validate/tui/ValidateView.js';
import type { ValidateViewEntry } from '../../../../src/print/validate/tui/ValidateView.js';

// Strip ANSI escapes, normalize the package version, AND collapse the TopBar's
// variable-width gap. See AnalyzeView.test.tsx for the full rationale; the
// short version: ink/string-width disagree across Node versions on some chars,
// so `<Box justifyContent="space-between">` produces 1+ char of width drift
// between local snapshot capture and CI. The sentinel keeps the snapshot
// readable but width-agnostic.
const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/v\d+\.\d+\.\d+/g, 'v<version>')
    .replace(/(experience-design-system-cli {2}\S+) +(\[\?\])/, '$1   $2');

const validResults: ValidateViewEntry[] = [
  {
    filePath: '/project/components.json',
    format: 'CDF v1',
    valid: true,
    summary: 'Valid CDF v1 — 5 components found',
    diagnostics: [],
  },
];

const invalidResults: ValidateViewEntry[] = [
  {
    filePath: '/project/components.json',
    format: 'CDF v1',
    valid: false,
    summary: '2 errors',
    diagnostics: [
      {
        path: '/Button/$properties/label',
        message: "must have required property '$type'",
      },
    ],
  },
  {
    filePath: '/project/tokens.json',
    format: 'DTCG',
    valid: true,
    summary: 'valid',
    diagnostics: [],
  },
];

describe('ValidateView', () => {
  it('renders valid files with green checkmark', () => {
    const { lastFrame } = render(<ValidateView results={validResults} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('Valid CDF');
  });

  it('renders invalid files with red X and error list', () => {
    const { lastFrame } = render(<ValidateView results={invalidResults} onExit={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗');
    expect(frame).toContain('must have required property');
  });

  it('calls onExit when q is pressed', async () => {
    const onExit = vi.fn();
    const { stdin } = render(<ValidateView results={validResults} onExit={onExit} />);
    stdin.write('q');
    await new Promise((r) => setTimeout(r, 30));
    expect(onExit).toHaveBeenCalled();
  });

  it('matches snapshot for all valid', () => {
    const { lastFrame } = render(<ValidateView results={validResults} onExit={vi.fn()} />);
    expect(stripAnsi(lastFrame() ?? '')).toMatchSnapshot();
  });

  it('matches snapshot with errors', () => {
    const { lastFrame } = render(<ValidateView results={invalidResults} onExit={vi.fn()} />);
    expect(stripAnsi(lastFrame() ?? '')).toMatchSnapshot();
  });
});
