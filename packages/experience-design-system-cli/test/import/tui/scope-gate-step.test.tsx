import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

// Pilot-2026-06-25 R2: scope-gate UX overhaul Round 2 tests. Pins the
// two-section render (AI recommended exclusions on top, Components below),
// color glyphs replacing word labels, subtle cyan `*` marker replacing the
// [AI] badge, and manual-decision-wins behavior preserved from Round 1.

const MIXED = [
  { name: 'Button', componentId: 'c0' },
  { name: 'DebugPanel', componentId: 'c1', aiDecision: 'rejected' as const, aiReason: 'internal-only widget' },
  { name: 'Card', componentId: 'c2' },
];

describe('ScopeGateStep — two-section render (R2 Task 1)', () => {
  it('renders all components across the two sections', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('DebugPanel');
    expect(out).toContain('Card');
  });

  it('AI-flagged rows render in a top "AI recommended exclusions (N)" section', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/AI recommended exclusions \(1\)/);
    expect(out).toMatch(/Components \(2\)/);
    const lines = out.split('\n');
    const aiHeaderIdx = lines.findIndex((l) => l.includes('AI recommended exclusions'));
    const compHeaderIdx = lines.findIndex((l) => l.includes('Components ('));
    const debugIdx = lines.findIndex((l) => l.includes('DebugPanel'));
    const buttonIdx = lines.findIndex((l) => l.includes('Button'));
    expect(aiHeaderIdx).toBeGreaterThan(-1);
    expect(compHeaderIdx).toBeGreaterThan(aiHeaderIdx);
    expect(debugIdx).toBeGreaterThan(aiHeaderIdx);
    expect(debugIdx).toBeLessThan(compHeaderIdx);
    expect(buttonIdx).toBeGreaterThan(compHeaderIdx);
  });

  it('toggling an AI-flagged row INCLUDED leaves it in the AI section', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Cursor starts on DebugPanel (first AI row). Toggle it.
    stdin.write('a');
    const out = lastFrame() ?? '';
    const lines = out.split('\n');
    const aiHeaderIdx = lines.findIndex((l) => l.includes('AI recommended exclusions'));
    const compHeaderIdx = lines.findIndex((l) => l.includes('Components ('));
    const debugIdx = lines.findIndex((l) => l.includes('DebugPanel'));
    expect(debugIdx).toBeGreaterThan(aiHeaderIdx);
    expect(debugIdx).toBeLessThan(compHeaderIdx);
  });

  it('cursor j moves from the last AI row to the first Components row', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Cursor starts at first AI row (DebugPanel). One j → first Components row (Button).
    stdin.write('j');
    const out = lastFrame() ?? '';
    const cursorLine = out.split('\n').find((l) => l.includes('›'));
    expect(cursorLine).toBeTruthy();
    expect(cursorLine!).toContain('Button');
  });

  it('AI-rejected rows start as EXCLUDED, AI-accepted/undecided rows start as INCLUDED', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.rejected).toEqual(['DebugPanel']);
  });

  it('toggling with `a` flips the focused row INCLUDED ↔ EXCLUDED', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Cursor starts on DebugPanel (AI section, EXCLUDED). One j → Button. `a` excludes.
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toContain('Button');
    expect(arg.accepted).not.toContain('Button');
  });
});

describe('ScopeGateStep — color glyphs (R2 Task 2)', () => {
  it('renders [✓] glyph for INCLUDED rows and [✗] for EXCLUDED rows', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[✓]');
    expect(out).toContain('[✗]');
  });

  it('emits NO INCLUDED / EXCLUDED word labels', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('INCLUDED');
    expect(out).not.toContain('EXCLUDED');
  });

  it('places the [✓] glyph before included names and [✗] before excluded names', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    // DebugPanel is AI-rejected -> red [✗] glyph in front.
    expect(out).toMatch(/\[✗\][^\n]*DebugPanel/);
    // Button is an INCLUDED component row -> green [✓] glyph in front.
    expect(out).toMatch(/\[✓\][^\n]*Button/);
  });
});

describe('ScopeGateStep — persistent [AI] badge (Task 2)', () => {
  it('renders an [AI] badge on rows where aiDecision === "rejected"', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    // DebugPanel was AI-rejected, must show [AI] badge.
    expect(out).toMatch(/\[AI\][^\n]*DebugPanel/);
  });

  it('keeps the [AI] badge after operator toggles the row to INCLUDED', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Move cursor to DebugPanel and toggle to INCLUDED.
    stdin.write('j');
    stdin.write('a');
    const out = lastFrame() ?? '';
    // Badge still visible on DebugPanel even though it's now INCLUDED.
    expect(out).toMatch(/\[AI\][^\n]*DebugPanel/);
    expect(out).toMatch(/DebugPanel/);
  });

  it('does NOT render [AI] on rows the AI did not reject', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[{ name: 'Button', componentId: 'c0' }]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('[AI]');
  });
});

describe('ScopeGateStep — manual decision wins over streaming AI (Task 3)', () => {
  it('row stays in place and INCLUDED when AI later rejects an operator-included row', () => {
    const onConfirm = vi.fn();
    const initial = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const { rerender, lastFrame, stdin } = render(
      <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Operator explicitly toggles Button OFF then ON to mark it as manual-include.
    stdin.write('a'); // EXCLUDE Button
    stdin.write('a'); // INCLUDE Button (now in userUnExcluded)
    // AI streams in a rejection for Button.
    const streamed = [
      { name: 'Button', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: 'AI thinks no' },
      { name: 'Card', componentId: 'c1' },
    ];
    rerender(<ScopeGateStep components={streamed} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />);
    const out = lastFrame() ?? '';
    // Order preserved (Button first, then Card).
    const buttonIdx = out.indexOf('Button');
    const cardIdx = out.indexOf('Card');
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(buttonIdx);
    // [AI] badge appears on Button now.
    expect(out).toMatch(/\[AI\][^\n]*Button/);
    // f confirms Button is still in accepted.
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('Button');
    expect(arg.rejected).not.toContain('Button');
  });

  it('row stays EXCLUDED across re-renders when operator excludes an AI-accepted row', () => {
    const onConfirm = vi.fn();
    const initial = [
      { name: 'Button', componentId: 'c0', aiDecision: 'accepted' as const },
      { name: 'Card', componentId: 'c1' },
    ];
    const { rerender, stdin } = render(
      <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('a'); // Exclude Button.
    rerender(<ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />);
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toContain('Button');
  });
});

describe('ScopeGateStep — focused-row reason wrap + brighter colors (Task 4)', () => {
  it('renders the full reason on a separate line below the focused AI row', () => {
    const longReason =
      'this widget is internal-only and would not make sense as a public design-system primitive because it depends on private context that we do not want to leak into the public API surface';
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'DebugPanel', componentId: 'c1', aiDecision: 'rejected', aiReason: longReason },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // DebugPanel is in the AI section (top); cursor starts there at i=0.
    const out = lastFrame() ?? '';
    // Full reason must appear (untruncated).
    expect(out).toContain('depends on private context');
    // And on a different line from the row label.
    const debugLineIdx = out.split('\n').findIndex((line) => line.includes('DebugPanel'));
    const reasonLineIdx = out.split('\n').findIndex((line) => line.includes('depends on private context'));
    expect(reasonLineIdx).toBeGreaterThan(debugLineIdx);
  });

  it('renders truncated inline reason on non-focused AI rows', () => {
    const longReason = 'a'.repeat(120);
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={[
          { name: 'Other', componentId: 'c0', aiDecision: 'rejected', aiReason: 'short' },
          { name: 'Button', componentId: 'c1' },
          { name: 'DebugPanel', componentId: 'c2', aiDecision: 'rejected', aiReason: longReason },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // Cursor starts at Other (first AI row). Move down once to put cursor
    // on DebugPanel? No — we want DebugPanel to be NON-focused so its long
    // reason is truncated inline. Stay on Other; DebugPanel is second AI row.
    void stdin;
    const out = lastFrame() ?? '';
    expect(out).toContain('…');
    expect(out).not.toContain('a'.repeat(120));
  });
});

describe('ScopeGateStep — legend update (Task 5)', () => {
  it('legend shows toggle (not reject), continue, quit, toggle-all', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[{ name: 'Button', componentId: 'c0' }]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('toggle');
    expect(out).toContain('toggle all');
    expect(out).toContain('continue');
    expect(out).toContain('quit');
    // The `[c]` collapse hint should be gone.
    expect(out).not.toMatch(/\[c\]/);
    // No `[r] reject` since `r` is now an alias for toggle.
    expect(out).not.toMatch(/\[r\][^\n]*reject/i);
  });

  it('shows [s] AI reason only when at least one AI-flagged row exists', () => {
    const { lastFrame: framePlain } = render(
      <ScopeGateStep
        components={[{ name: 'Button', componentId: 'c0' }]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const plainOut = framePlain() ?? '';
    expect(plainOut).not.toContain('AI reason');

    const { lastFrame: frameAi } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'X', componentId: 'c1', aiDecision: 'rejected', aiReason: 'no' },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const aiOut = frameAi() ?? '';
    // `[s]` legend entry present (ink may wrap "AI reason" mid-phrase on
    // narrow widths, so don't assert the words contiguously).
    expect(aiOut).toContain('[s]');
    expect(aiOut).toContain('reason');
  });
});
