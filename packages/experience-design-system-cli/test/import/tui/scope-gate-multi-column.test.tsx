import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import {
  ScopeGateStep,
  sideColumnLabelStyle,
} from '../../../src/import/tui/steps/ScopeGateStep.js';

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

describe('sideColumnLabelStyle', () => {
  it('cursor row (selected + focused) forces bold white + inverse and overrides green/red/dim', () => {
    const nonCycle = sideColumnLabelStyle({ isCycle: false, isSelected: true, focused: true });
    expect(nonCycle.nameColor).toBe('white');
    expect(nonCycle.nameBold).toBe(true);
    expect(nonCycle.nameInverse).toBe(true);
    expect(nonCycle.nameUnderline).toBe(false);
    expect(nonCycle.suffixColor).toBe('white');
    expect(nonCycle.suffixDim).toBe(false);
    expect(nonCycle.suffixInverse).toBe(true);

    // Cycle rows also collapse to bold white on the cursor line.
    const cycle = sideColumnLabelStyle({ isCycle: true, isSelected: true, focused: true });
    expect(cycle.nameColor).toBe('white');
    expect(cycle.nameBold).toBe(true);
    expect(cycle.nameInverse).toBe(true);
  });

  it('selected but not focused: underline is on, retains base coloring', () => {
    const nonCycle = sideColumnLabelStyle({ isCycle: false, isSelected: true, focused: false });
    expect(nonCycle.nameColor).toBe('green');
    expect(nonCycle.nameInverse).toBe(false);
    expect(nonCycle.nameUnderline).toBe(true);
    expect(nonCycle.suffixColor).toBe('cyan');
    expect(nonCycle.suffixDim).toBe(true);
    expect(nonCycle.suffixUnderline).toBe(true);

    const cycle = sideColumnLabelStyle({ isCycle: true, isSelected: true, focused: false });
    expect(cycle.nameColor).toBe('red');
    expect(cycle.nameUnderline).toBe(true);
    expect(cycle.suffixColor).toBe('red');
  });

  it('non-selected non-cycle row: green name, dim cyan suffix, no underline', () => {
    const s = sideColumnLabelStyle({ isCycle: false, isSelected: false, focused: false });
    expect(s.nameColor).toBe('green');
    expect(s.nameBold).toBe(false);
    expect(s.nameInverse).toBe(false);
    expect(s.nameUnderline).toBe(false);
    expect(s.suffixColor).toBe('cyan');
    expect(s.suffixDim).toBe(true);
    expect(s.suffixInverse).toBe(false);
  });

  it('non-selected cycle row: red name AND red suffix (cycle color applies to whole label)', () => {
    const s = sideColumnLabelStyle({ isCycle: true, isSelected: false, focused: false });
    expect(s.nameColor).toBe('red');
    expect(s.suffixColor).toBe('red');
    expect(s.suffixDim).toBe(false);
  });

  it('focused but not selected: green (or red) is preserved', () => {
    const s = sideColumnLabelStyle({ isCycle: false, isSelected: false, focused: true });
    expect(s.nameColor).toBe('green');
    expect(s.nameInverse).toBe(false);
    expect(s.nameUnderline).toBe(false);
  });
});

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

  it('[r] in Added-components rejects the highlighted row via reject-cascade machinery', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Baseline: Standalone is accepted; rejecting it has no cascade (blast
    // radius 0), so it flips straight to rejected and drops off the
    // added-components list.
    stdin.write('\t');
    stdin.write('\x1b[B');
    stdin.write('\x1b[B');
    // Now at Standalone (Card, Icon, Standalone, Text alphabetical).
    expect(lastFrame() ?? '').toMatch(/▶ Standalone\b/);
    stdin.write('r');
    const out = lastFrame() ?? '';
    // Standalone is no longer in the accepted list, so the side-column no
    // longer shows a ▶ next to it. Counter reflects the flip.
    expect(out).not.toMatch(/▶ Standalone\b/);
    expect(out).toMatch(/Accepted[^0-9]*3[^0-9]*4/);
    expect(out).toMatch(/Rejected[^0-9]*1/);
  });

  it('[a] in Added-components is a no-op (side columns only accept [r])', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('\t');
    stdin.write('\x1b[B');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Standalone\b/);
    stdin.write('a');
    const out = lastFrame() ?? '';
    // No state change: Standalone still accepted, still in the column.
    expect(out).toMatch(/▶ Standalone\b/);
    expect(out).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    expect(out).toMatch(/Rejected[^0-9]*0/);
  });

  it('Space in Added-components is a no-op (side columns only accept [r])', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('\t');
    stdin.write('\x1b[B');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Standalone\b/);
    stdin.write(' ');
    const out = lastFrame() ?? '';
    expect(out).toMatch(/▶ Standalone\b/);
    expect(out).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    expect(out).toMatch(/Rejected[^0-9]*0/);
  });

  it('[a] in Added-groups is a no-op; [r] rejects the composite root', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Tab twice: main → added-components → added-groups. Highlighted row is
    // "Card (2 deps)". [a] should not change state.
    stdin.write('\t');
    stdin.write('\t');
    expect(lastFrame() ?? '').toMatch(/▶ Card \(2 deps\)/);
    stdin.write('a');
    const afterA = lastFrame() ?? '';
    expect(afterA).toMatch(/▶ Card \(2 deps\)/);
    expect(afterA).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    // Space: still no-op.
    stdin.write(' ');
    const afterSpace = lastFrame() ?? '';
    expect(afterSpace).toMatch(/▶ Card \(2 deps\)/);
    expect(afterSpace).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    // [r]: reject Card → cascade prompt (2 descendants), confirm with y.
    stdin.write('r');
    stdin.write('y');
    const afterR = lastFrame() ?? '';
    // Card is now rejected → drops out of added-groups.
    expect(afterR).not.toMatch(/▶ Card \(2 deps\)/);
  });
});

describe('ScopeGateStep — legend advertises Enter-jump', () => {
  it('shows [Enter] jump to main in three-column layout', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[Enter]');
    expect(out).toContain('jump to main');
  });

  it('omits [Enter] jump to main in narrow (single-column) layout', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('jump to main');
  });
});

describe('ScopeGateStep — [L] large-list view toggle', () => {
  it('advertises [L] large list in the legend', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[L]');
    expect(out).toContain('large list');
  });

  it('grouped view (default) renders composite tree with ▾/├─/└─ glyphs', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    // Card is a composite root; grouped view renders `▾ Card (2 deps)` and
    // tree glyphs on descendants (├─ before a child name).
    expect(out).toMatch(/▾[^\n]*Card/);
    expect(out).toMatch(/├─ /);
  });

  it('[L] switches Column 1 to large-list: no tree glyphs, one row per component', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('L');
    const out = lastFrame() ?? '';
    // Tree glyphs from grouped view are gone (child rows use `├─ ` / `└─ `
    // with a trailing space; box borders also use `└─` without a space, so
    // require the trailing space to avoid matching the border).
    expect(out).not.toMatch(/├─ /);
    expect(out).not.toMatch(/└─ /);
    expect(out).not.toMatch(/▾/);
    // Every component appears (Card, Icon, Standalone, Text).
    expect(out).toContain('Card (2 deps)');
    expect(out).toContain('Icon');
    expect(out).toContain('Standalone');
    expect(out).toContain('Text');
  });

  it('[L] toggles between grouped and large-list views', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('L');
    expect(lastFrame() ?? '').not.toMatch(/├─ /);
    stdin.write('L');
    // Back to grouped: tree glyphs return.
    expect(lastFrame() ?? '').toMatch(/├─ /);
  });

  it('cycle participants pin to the top in large-list mode', () => {
    const CYCLE_GRAPH = [
      { name: 'Loopy', componentId: 'c0', slots: [{ name: 'child', allowedComponents: ['Inner'] }] },
      { name: 'Inner', componentId: 'c1', slots: [{ name: 'back', allowedComponents: ['Loopy'] }] },
      { name: 'Card', componentId: 'c2', slots: [{ name: 'body', allowedComponents: ['Text'] }] },
      { name: 'Text', componentId: 'c3' },
    ];
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CYCLE_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('L');
    const out = lastFrame() ?? '';
    const innerPos = out.indexOf('⚠ Inner');
    const loopyPos = out.indexOf('⚠ Loopy');
    const cardPos = out.indexOf('Card (1 dep)');
    expect(innerPos).toBeGreaterThan(-1);
    expect(loopyPos).toBeGreaterThan(innerPos);
    expect(cardPos).toBeGreaterThan(loopyPos);
  });

  it('cursor persists on the same component across view toggle', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Move down: grouped view starts with Card at row 0. Down → first child
    // (Icon or Text). Grouped ordering: Card, ├─ Icon, └─ Text, Standalone.
    stdin.write('\x1b[B'); // down → Icon (group-child)
    const beforeToggle = lastFrame() ?? '';
    expect(beforeToggle).toMatch(/▶[^\n]*Icon/);
    stdin.write('L');
    const afterToggle = lastFrame() ?? '';
    // Cursor should now land on the Icon row in large-list ordering
    // (alphabetical: Card, Icon, Standalone, Text).
    expect(afterToggle).toMatch(/▶[^\n]*Icon/);
  });
});

describe('ScopeGateStep — Column 1 flat-tier removal', () => {
  it('does not render the "── All components ──" flat-tier header in Column 1', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('All components');
  });
});

describe('ScopeGateStep — cycle participants in side columns', () => {
  const CYCLE_GRAPH = [
    { name: 'Loopy', componentId: 'c0', slots: [{ name: 'child', allowedComponents: ['Inner'] }] },
    { name: 'Inner', componentId: 'c1', slots: [{ name: 'back', allowedComponents: ['Loopy'] }] },
    { name: 'Card', componentId: 'c2', slots: [{ name: 'body', allowedComponents: ['Text'] }] },
    { name: 'Text', componentId: 'c3' },
  ];

  it('renders an accepted cycle-participant at the top of Column 2 with a ⚠ prefix', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CYCLE_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Added components');
    // Cycle-tier row carries the ⚠ glyph. Loopy and Inner both participate.
    const cycleLine = out.split('\n').find((l) => /⚠ (Inner|Loopy)\b/.test(l));
    expect(cycleLine).toBeDefined();
  });

  it('places cycle members alphabetically at the top of Column 2 before non-cycle rows', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CYCLE_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    // Cycle-tier rows have ⚠ prefixes. Non-cycle rows in Column 2 do not.
    // Assert overall ordering: ⚠ Inner (cycle-tier alphabetical first) appears
    // before ⚠ Loopy, which appears before the first non-cycle line for Card.
    const innerPos = out.indexOf('⚠ Inner');
    const loopyPos = out.indexOf('⚠ Loopy');
    expect(innerPos).toBeGreaterThan(-1);
    expect(loopyPos).toBeGreaterThan(innerPos);
    // Column 2's non-cycle "Card" row is the one on the same line as its ⚠
    // separator group — we match a line that begins with whitespace + "Card"
    // and lacks "(1 dep)" (that suffix only appears in Column 3).
    const lines = out.split('\n');
    const col2CardLineIdx = lines.findIndex(
      (l) => /^\s+Card$/.test(l.replace(/\s+$/, '')) || (l.includes('  Card') && !l.includes('(1 dep)') && !l.includes('⚠')),
    );
    expect(col2CardLineIdx).toBeGreaterThan(-1);
    const loopyLineIdx = lines.findIndex((l) => l.includes('⚠ Loopy') && !l.includes('(cycle)'));
    // Column 2's ⚠ Loopy line (no "(cycle)" suffix — that's in Column 1).
    expect(loopyLineIdx).toBeGreaterThan(-1);
    expect(col2CardLineIdx).toBeGreaterThan(loopyLineIdx);
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

  it('renders [×] on AI-flagged accepted rows in the Added-components column', () => {
    // DebugPanel is AI-flagged (aiDecision:'rejected') so it starts rejected
    // per the ScopeGateStep baseline — accept it to force it into the Added
    // column, mirroring the "user overrode the AI's suggestion" flow.
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={AI_FLAGGED_GRAPH}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // Card, Text, DebugPanel — DebugPanel is last after Card (2 rows down
    // through the main-column tree: Card, ├─ Text, ── flat header, Card,
    // DebugPanel, Text). Jump to DebugPanel via search to keep the test
    // resilient to sidebar row-ordering shifts.
    stdin.write('/');
    for (const ch of 'DebugPanel') stdin.write(ch);
    stdin.write('\r');
    // Accept it (baseline was rejected).
    stdin.write('a');
    const out = lastFrame() ?? '';
    // Locate the Added-components column: its lines follow the header. Find a
    // row that carries both DebugPanel and [×] — exclusion of the AI banner
    // line (dimmed, no [×]) and the main-sidebar row (has [✓]) leaves the
    // Added-components row as the unique remaining match.
    const lines = out.split('\n');
    const flaggedAddedLine = lines.find(
      (line) =>
        line.includes('DebugPanel') &&
        line.includes('[×]') &&
        !line.includes('[✓]') &&
        !line.includes('[ ]') &&
        !line.includes('▾') &&
        !line.includes('├─') &&
        !line.includes('└─'),
    );
    expect(flaggedAddedLine).toBeDefined();
  });

  it('renders [×] on an AI-flagged accepted composite root in the Added-groups column', () => {
    setWide(160);
    // Make the composite root itself AI-flagged. User overrides → accepts it,
    // so the root shows up in Added-groups with a red [×] warning.
    const graph = [
      {
        name: 'Card',
        componentId: 'c0',
        aiDecision: 'rejected' as const,
        aiReason: 'suspected trash component',
        slots: [{ name: 'body', allowedComponents: ['Text'] }],
      },
      { name: 'Text', componentId: 'c1' },
    ];
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={graph}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // Card starts rejected under the AI baseline. Toggle to accept — that
    // registers the whole composite in Added-groups.
    stdin.write('a');
    const out = lastFrame() ?? '';
    // Find a line that mentions the group "Card (1 dep)" AND [×]. The main
    // sidebar row for Card renders "▾ Card (1 dep)" whereas the Added-groups
    // row renders bare "Card (1 dep)" — the "▾" filter isolates the latter.
    const lines = out.split('\n');
    const flaggedGroupLine = lines.find(
      (line) =>
        line.includes('Card (1 dep)') &&
        line.includes('[×]') &&
        !line.includes('▾') &&
        !line.includes('▸'),
    );
    expect(flaggedGroupLine).toBeDefined();
  });

  it('side columns keep column-alignment when a peer row is AI-flagged (4-space placeholder)', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={AI_FLAGGED_GRAPH}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // Accept DebugPanel so it lands in Added-components alongside Card/Text.
    // Non-flagged peers must reserve a 4-space slot so their labels align
    // with DebugPanel's [×] badge.
    stdin.write('/');
    for (const ch of 'DebugPanel') stdin.write(ch);
    stdin.write('\r');
    stdin.write('a');
    const out = lastFrame() ?? '';
    // Terminal renders columns side-by-side per line. Isolate the segment
    // right of the main-sidebar box border. The Added-components column
    // starts after '│' followed by whitespace. Look for a row whose
    // Added-components slice begins with the reserved 4-space padding
    // followed by ` Card` (peer of the DebugPanel [×] row).
    const addedRegion = out
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('│  ');
        return idx >= 0 ? line.slice(idx) : line;
      })
      .join('\n');
    // A row like "        Card" (4-space badge slot + " Card"). The
    // DebugPanel peer renders as "    [×] DebugPanel" — those [×] columns
    // must line up with each other.
    expect(addedRegion).toMatch(/\s{4} Card\b/);
    expect(addedRegion).toMatch(/ \[×\] DebugPanel\b/);
  });
});
