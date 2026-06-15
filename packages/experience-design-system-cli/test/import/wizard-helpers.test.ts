import { describe, it, expect } from 'vitest';
import { buildAnalyzeSelectArgs, formatAcceptanceSummary } from '../../src/import/tui/WizardApp.js';

describe('buildAnalyzeSelectArgs (wizard subprocess args)', () => {
  it('builds interactive args (no --select-all) for manual review', () => {
    expect(buildAnalyzeSelectArgs({ sessionId: 'sess-1', acceptAll: false })).toEqual([
      'analyze',
      'select',
      '--session',
      'sess-1',
    ]);
  });

  it('builds --select-all + --exclude-invalid args for bulk-approve', () => {
    // The wizard pre-shows validation errors in the analyze-extract TUI, so
    // we always pass --exclude-invalid to bypass the headless fail-loud gate.
    // The auto-rejection is surfaced to the user via formatAcceptanceSummary
    // on the next screen.
    expect(buildAnalyzeSelectArgs({ sessionId: 'sess-1', acceptAll: true })).toEqual([
      'analyze',
      'select',
      '--session',
      'sess-1',
      '--select-all',
      '--exclude-invalid',
    ]);
  });
});

describe('formatAcceptanceSummary (wizard "Generating definitions" step)', () => {
  it('shows accepted count without exclusion when none were auto-rejected', () => {
    const out = formatAcceptanceSummary({ accepted: 5, autoRejected: 0 });
    expect(out).toBe('5 components accepted.');
  });

  it('singularizes when only one was accepted and none excluded', () => {
    expect(formatAcceptanceSummary({ accepted: 1, autoRejected: 0 })).toBe('1 component accepted.');
  });

  it('appends an exclusion clause when components were auto-rejected', () => {
    expect(formatAcceptanceSummary({ accepted: 5, autoRejected: 2 })).toBe(
      '5 components accepted, 2 excluded due to validation errors.',
    );
  });

  it('singularizes the exclusion clause for a single excluded component', () => {
    expect(formatAcceptanceSummary({ accepted: 5, autoRejected: 1 })).toBe(
      '5 components accepted, 1 excluded due to validation errors.',
    );
  });

  it('handles zero accepted with exclusions (all-invalid edge case)', () => {
    expect(formatAcceptanceSummary({ accepted: 0, autoRejected: 3 })).toBe(
      '0 components accepted, 3 excluded due to validation errors.',
    );
  });
});
