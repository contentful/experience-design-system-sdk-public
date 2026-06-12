import { describe, it, expect } from 'vitest';
import {
  buildAnalyzeSelectArgs,
  formatAcceptanceSummary,
  formatGeneratedSummary,
} from '../../src/import/tui/WizardApp.js';

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

describe('formatGeneratedSummary (wizard "review-generated-gate" step)', () => {
  it('shows only the generated count when nothing was renamed or excluded', () => {
    expect(formatGeneratedSummary({ generated: 5, renamedSlots: 0, autoRejected: 0 })).toBe(
      'Generated definitions for 5 components.',
    );
  });

  it('singularizes the generated count', () => {
    expect(formatGeneratedSummary({ generated: 1, renamedSlots: 0, autoRejected: 0 })).toBe(
      'Generated definitions for 1 component.',
    );
  });

  it('appends the renamed-slots clause when slots were renamed', () => {
    expect(formatGeneratedSummary({ generated: 5, renamedSlots: 3, autoRejected: 0 })).toBe(
      'Generated definitions for 5 components. 3 unnamed slots renamed (children / slot_<n>) so the LLM could classify them.',
    );
  });

  it('singularizes the renamed-slots clause for one slot', () => {
    expect(formatGeneratedSummary({ generated: 5, renamedSlots: 1, autoRejected: 0 })).toBe(
      'Generated definitions for 5 components. 1 unnamed slot renamed (children / slot_<n>) so the LLM could classify them.',
    );
  });

  it('appends the exclusion clause when components were auto-rejected upstream', () => {
    expect(formatGeneratedSummary({ generated: 5, renamedSlots: 0, autoRejected: 2 })).toBe(
      'Generated definitions for 5 components. 2 components excluded earlier due to validation errors.',
    );
  });

  it('combines renamed-slot and exclusion clauses when both apply', () => {
    expect(formatGeneratedSummary({ generated: 5, renamedSlots: 3, autoRejected: 2 })).toBe(
      'Generated definitions for 5 components. 3 unnamed slots renamed (children / slot_<n>) so the LLM could classify them. 2 components excluded earlier due to validation errors.',
    );
  });
});
