import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

/**
 * Multi-column scope-gate layout tests. The three-column layout only renders
 * at terminal widths ≥ 120. ink-testing-library's Stdout hard-codes columns
 * to 100, so we monkey-patch its prototype for wide-terminal tests.
 */

function withStdoutColumns(cols: number): () => void {
  // Render once to obtain a stdout instance (and its prototype).
  const probe = render(<Empty />);
  const proto = Object.getPrototypeOf(probe.stdout);
  const original = Object.getOwnPropertyDescriptor(proto, 'columns');
  Object.defineProperty(proto, 'columns', {
    configurable: true,
    get: () => cols,
  });
  probe.unmount();
  probe.cleanup();
  return () => {
    if (original) Object.defineProperty(proto, 'columns', original);
  };
}

function Empty(): React.ReactElement {
  return React.createElement('text', null, '');
}

const restorers: Array<() => void> = [];
afterEach(() => {
  while (restorers.length > 0) restorers.pop()!();
});

function setWide(cols = 160): void {
  restorers.push(withStdoutColumns(cols));
}

const CARD_GRAPH = [
  { name: 'Card', componentId: 'c0', slots: [{ name: 'body', allowedComponents: ['Text', 'Icon'] }] },
  { name: 'Text', componentId: 'c1' },
  { name: 'Icon', componentId: 'c2' },
  { name: 'Standalone', componentId: 'c3' },
];

const AI_FLAGGED_GRAPH = [
  { name: 'Card', componentId: 'c0', slots: [{ name: 'body', allowedComponents: ['Text'] }] },
  { name: 'Text', componentId: 'c1' },
  {
    name: 'DebugPanel',
    componentId: 'c2',
    aiDecision: 'rejected' as const,
    aiReason: 'internal-only debugging widget',
  },
];

describe('ScopeGateStep — counter strip', () => {
  it('always renders the counter strip with Accepted / Groups / Rejected / Undecided labels', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Accepted');
    expect(out).toContain('Groups');
    expect(out).toContain('Rejected');
    expect(out).toContain('Undecided');
  });

  it('counter values reflect the initial accepted state (all-accepted baseline)', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    // 4 accepted out of 4, one composite root (Card) accepted.
    expect(out).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    expect(out).toMatch(/Groups[^0-9]*1/);
    expect(out).toMatch(/Rejected[^0-9]*0/);
    expect(out).toMatch(/Undecided[^0-9]*0/);
  });
});

describe('ScopeGateStep — three-column layout (wide terminal)', () => {
  it('renders "Added components" and "Added groups" columns at ≥ 120 cols', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Added components');
    expect(out).toContain('Added groups');
    // Legend advertises Tab.
    expect(out).toContain('switch column');
  });

  it('omits side columns at narrow terminals (< 120 cols)', () => {
    // Default testing-library width is 100 (< 120).
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('Added components');
    expect(out).not.toContain('Added groups');
    expect(out).not.toContain('switch column');
  });

  it('Shift-Tab reverse-cycles focus: main → added-groups → added-components → main', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Baseline: main column focused (its header is inverse). The three column
    // headers ("Components", "Added components", "Added groups") each render
    // via ColumnHeader; the focused one is the only one wrapped with inverse.
    // We assert focus indirectly via the "▶" cursor glyph which only renders
    // in the side columns when they are focused.
    const initial = lastFrame() ?? '';
    // "▶" doesn't render in side columns at rest (main is focused).
    // Confirm at least neither side-column cursor is drawn.
    // (added-components list is non-empty since all 4 components are accepted.)
    // Fire Shift-Tab: main → added-groups.
    stdin.write('\x1b[Z');
    const afterShift1 = lastFrame() ?? '';
    // added-groups focused → cursor glyph beside "Card (2 deps)" in the
    // added-groups column (single space between ▶ and label — distinguishes
    // from the main-sidebar row which has "▶  [✓]     ▾ Card").
    expect(afterShift1).toMatch(/▶ Card \(2 deps\)/);
    // Fire Shift-Tab again: added-groups → added-components.
    stdin.write('\x1b[Z');
    const afterShift2 = lastFrame() ?? '';
    // added-components focused → cursor glyph beside the first added component
    // (Card sorts first alphabetically among Card/Icon/Standalone/Text).
    expect(afterShift2).toMatch(/▶ Card\b/);
    // Fire Shift-Tab a third time: added-components → main.
    stdin.write('\x1b[Z');
    const afterShift3 = lastFrame() ?? '';
    // No side-column cursor glyph any more.
    expect(afterShift3).not.toMatch(/▶ Card \(2 deps\)/);
    expect(afterShift3).not.toMatch(/▶ Card\b/);
    // Sanity: nothing crashed and the multi-column layout still renders.
    expect(afterShift3).toContain('Added components');
    expect(afterShift3).toContain('Added groups');
    void initial;
  });

  it('legend advertises both Tab and Shift-Tab', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Tab/Shift-Tab');
  });

  it('Enter in the Added-components column jumps main cursor and returns focus to main', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Tab from main → added-components. Move down one row (Card → Icon,
    // alphabetical among Card/Icon/Standalone/Text). Enter should jump the
    // main cursor to Icon and return focus to main.
    stdin.write('\t');
    stdin.write('\x1b[B'); // down arrow → Icon
    // Side column shows its cursor while focused.
    expect(lastFrame() ?? '').toMatch(/▶ Icon\b/);
    stdin.write('\r');
    const out = lastFrame() ?? '';
    // Side-column cursor glyph is gone (focus returned to main).
    expect(out).not.toMatch(/▶ Icon\b/);
    // Main-column ▶ landed on Icon. Icon appears as a group-child of Card
    // (row label "├─ Icon" or similar) and again in the flat tier. The
    // grouped occurrence comes first; the ▶ glyph precedes the label with
    // reserved slots between them, so match a permissive "▶ ... Icon" line.
    expect(out).toMatch(/▶[^\n]*Icon/);
  });

  it('Enter in the Added-groups column jumps main cursor to composite root and returns focus to main', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Tab twice: main → added-components → added-groups.
    stdin.write('\t');
    stdin.write('\t');
    expect(lastFrame() ?? '').toMatch(/▶ Card \(2 deps\)/);
    stdin.write('\r');
    const out = lastFrame() ?? '';
    // Focus returned to main: no side-column cursor glyph on Card (2 deps).
    expect(out).not.toMatch(/▶ Card \(2 deps\)/);
    // Main-column ▶ lands on Card — the group-root row (rendered as
    // "▾ Card (2 deps)").
    expect(out).toMatch(/▶[^\n]*Card \(2 deps\)/);
  });

  it('side-column cursor persists across refocus (does not reset on Tab away and back)', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Tab to added-components, move to row 1 (Icon).
    stdin.write('\t');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Icon\b/);
    // Tab away twice (added-components → added-groups → main), then back to
    // added-components; cursor should still be on Icon.
    stdin.write('\t');
    stdin.write('\t');
    stdin.write('\t');
    expect(lastFrame() ?? '').toMatch(/▶ Icon\b/);
  });

  it('Space in Added-components toggles the highlighted row via reject-cascade machinery', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Baseline: Standalone is accepted; toggling it has no cascade (blast
    // radius 0), so it flips straight to rejected and drops off the
    // added-components list.
    stdin.write('\t');
    stdin.write('\x1b[B');
    stdin.write('\x1b[B');
    // Now at Standalone (Card, Icon, Standalone, Text alphabetical).
    expect(lastFrame() ?? '').toMatch(/▶ Standalone\b/);
    stdin.write(' ');
    const out = lastFrame() ?? '';
    // Standalone is no longer in the accepted list, so the side-column no
    // longer shows a ▶ next to it. Counter reflects the flip.
    expect(out).not.toMatch(/▶ Standalone\b/);
    expect(out).toMatch(/Accepted[^0-9]*3[^0-9]*4/);
    expect(out).toMatch(/Rejected[^0-9]*1/);
  });
});

describe('ScopeGateStep — AI suggestions (three-column layout)', () => {
  it('renders the AI-recommended-exclusions banner above the columns in wide layout', () => {
    // Regression: after the three-column layout landed, both AI-suggestion
    // signals — the banner text block and the per-row [×] glyph — must
    // continue to surface. Nothing in the narrow-layout scope-gate tests
    // covered this once the counter strip + side columns were introduced.
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep
        components={AI_FLAGGED_GRAPH}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    // Banner header + the flagged component's name + a fragment of the
    // truncated reason (defends against a future banner-suppression bug).
    expect(out).toContain('AI recommended exclusions');
    expect(out).toContain('DebugPanel');
    expect(out).toContain('internal-only debugging widget');
    // And the three-column layout is actually engaged for this test.
    expect(out).toContain('Added components');
    expect(out).toContain('Added groups');
  });

  it('renders the per-row [×] AI badge in the main sidebar in wide layout', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep
        components={AI_FLAGGED_GRAPH}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    // [×] appears on the DebugPanel row specifically. GroupedSidebar reserves
    // a 4-char slot for the badge column, so the glyph precedes the label
    // (with a space between them).
    expect(out).toContain('[×]');
    // Two lines mention DebugPanel: the banner (no [×]) and the sidebar row
    // (has [×]). Assert at least one sidebar row co-locates [×] with the name.
    const sidebarLine = out
      .split('\n')
      .find((line) => line.includes('DebugPanel') && line.includes('[×]'));
    expect(sidebarLine).toBeDefined();
    // Legend also advertises the badge (surfaces via `hasAnyAi`).
    expect(out).toContain('AI recommends');
  });
});
