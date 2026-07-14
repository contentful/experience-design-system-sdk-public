import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import {
  ScopeGateStep,
  sideColumnLabelStyle,
} from '../../../src/import/tui/steps/ScopeGateStep.js';
import { PALETTE } from '../../../src/analyze/select/tui/theme.js';


function withStdoutColumns(cols: number): () => void {
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
    expect(nonCycle.nameColor).toBe(PALETTE.inverse);
    expect(nonCycle.nameBold).toBe(true);
    expect(nonCycle.nameInverse).toBe(true);
    expect(nonCycle.nameUnderline).toBe(false);
    expect(nonCycle.suffixColor).toBe(PALETTE.inverse);
    expect(nonCycle.suffixDim).toBe(false);
    expect(nonCycle.suffixInverse).toBe(true);

    const cycle = sideColumnLabelStyle({ isCycle: true, isSelected: true, focused: true });
    expect(cycle.nameColor).toBe(PALETTE.inverse);
    expect(cycle.nameBold).toBe(true);
    expect(cycle.nameInverse).toBe(true);
  });

  it('selected but not focused: underline is on, retains base coloring', () => {
    const nonCycle = sideColumnLabelStyle({ isCycle: false, isSelected: true, focused: false });
    expect(nonCycle.nameColor).toBe(PALETTE.success);
    expect(nonCycle.nameInverse).toBe(false);
    expect(nonCycle.nameUnderline).toBe(true);
    expect(nonCycle.suffixColor).toBe(PALETTE.info);
    expect(nonCycle.suffixDim).toBe(true);
    expect(nonCycle.suffixUnderline).toBe(true);

    const cycle = sideColumnLabelStyle({ isCycle: true, isSelected: true, focused: false });
    expect(cycle.nameColor).toBe(PALETTE.error);
    expect(cycle.nameUnderline).toBe(true);
    expect(cycle.suffixColor).toBe(PALETTE.error);
  });

  it('non-selected non-cycle row: green name, dim cyan suffix, no underline', () => {
    const s = sideColumnLabelStyle({ isCycle: false, isSelected: false, focused: false });
    expect(s.nameColor).toBe(PALETTE.success);
    expect(s.nameBold).toBe(false);
    expect(s.nameInverse).toBe(false);
    expect(s.nameUnderline).toBe(false);
    expect(s.suffixColor).toBe(PALETTE.info);
    expect(s.suffixDim).toBe(true);
    expect(s.suffixInverse).toBe(false);
  });

  it('non-selected cycle row: red name AND red suffix (cycle color applies to whole label)', () => {
    const s = sideColumnLabelStyle({ isCycle: true, isSelected: false, focused: false });
    expect(s.nameColor).toBe(PALETTE.error);
    expect(s.suffixColor).toBe(PALETTE.error);
    expect(s.suffixDim).toBe(false);
  });

  it('focused but not selected: green (or red) is preserved', () => {
    const s = sideColumnLabelStyle({ isCycle: false, isSelected: false, focused: true });
    expect(s.nameColor).toBe(PALETTE.success);
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

  it('counter values reflect the undecided baseline at mount (nothing pre-accepted)', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/Accepted[^0-9]*0[^0-9]*4/);
    expect(out).toMatch(/Groups[^0-9]*0/);
    expect(out).toMatch(/Rejected[^0-9]*0/);
    expect(out).toMatch(/Undecided[^0-9]*4/);
  });

  it('counter values after [A]: 4 accepted, 1 group, 0 rejected, 0 undecided', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
    const out = lastFrame() ?? '';
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
    expect(out).toContain('switch column');
  });

  it('omits side columns at narrow terminals (< 120 cols)', () => {
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
    stdin.write('A');
    const initial = lastFrame() ?? '';
    stdin.write('\x1b[Z');
    const afterShift1 = lastFrame() ?? '';
    expect(afterShift1).toMatch(/▶ Card \(2 deps\)/);
    stdin.write('\x1b[Z');
    const afterShift2 = lastFrame() ?? '';
    expect(afterShift2).toMatch(/▶ Card\b/);
    stdin.write('\x1b[Z');
    const afterShift3 = lastFrame() ?? '';
    expect(afterShift3).not.toMatch(/▶ Card \(2 deps\)/);
    expect(afterShift3).not.toMatch(/▶ Card\b/);
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
    stdin.write('A');
    stdin.write('\t');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Icon\b/);
    stdin.write('\r');
    const out = lastFrame() ?? '';
    expect(out).not.toMatch(/▶ Icon\b/);
    expect(out).toMatch(/▶[^\n]*Icon/);
  });

  it('Enter in the Added-groups column jumps main cursor to composite root and returns focus to main', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('\t');
    stdin.write('\t');
    expect(lastFrame() ?? '').toMatch(/▶ Card \(2 deps\)/);
    stdin.write('\r');
    const out = lastFrame() ?? '';
    expect(out).not.toMatch(/▶ Card \(2 deps\)/);
    expect(out).toMatch(/▶[^\n]*Card \(2 deps\)/);
  });

  it('side-column cursor persists across refocus (does not reset on Tab away and back)', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('\t');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Icon\b/);
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
    stdin.write('A');
    stdin.write('\t');
    stdin.write('\x1b[B');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Standalone\b/);
    stdin.write('r');
    const out = lastFrame() ?? '';
    expect(out).not.toMatch(/▶ Standalone\b/);
    expect(out).toMatch(/Accepted[^0-9]*3[^0-9]*4/);
    expect(out).toMatch(/Rejected[^0-9]*1/);
  });

  it('[a] in Added-components is a no-op (side columns only accept [r])', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('\t');
    stdin.write('\x1b[B');
    stdin.write('\x1b[B');
    expect(lastFrame() ?? '').toMatch(/▶ Standalone\b/);
    stdin.write('a');
    const out = lastFrame() ?? '';
    expect(out).toMatch(/▶ Standalone\b/);
    expect(out).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    expect(out).toMatch(/Rejected[^0-9]*0/);
  });

  it('Space in Added-components is a no-op (side columns only accept [r])', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
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
    stdin.write('A');
    stdin.write('\t');
    stdin.write('\t');
    expect(lastFrame() ?? '').toMatch(/▶ Card \(2 deps\)/);
    stdin.write('a');
    const afterA = lastFrame() ?? '';
    expect(afterA).toMatch(/▶ Card \(2 deps\)/);
    expect(afterA).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    stdin.write(' ');
    const afterSpace = lastFrame() ?? '';
    expect(afterSpace).toMatch(/▶ Card \(2 deps\)/);
    expect(afterSpace).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    stdin.write('r');
    stdin.write('y');
    const afterR = lastFrame() ?? '';
    expect(afterR).not.toMatch(/▶ Card \(2 deps\)/);
  });
});

describe('ScopeGateStep — T10 side-column borders', () => {
  it('renders single-line borders around columns 2 and 3', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    const corners = (out.match(/┌/g) ?? []).length;
    expect(corners).toBe(3);
    expect(out).toContain('Added components');
    expect(out).toContain('Added groups');
  });

  it('does NOT add extra borders at narrow terminals (single-column layout)', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    const corners = (out.match(/┌/g) ?? []).length;
    expect(corners).toBe(1);
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

describe('ScopeGateStep — [L] flat view toggle', () => {
  it('advertises [L] flat in the legend', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[L]');
    expect(out).toContain('flat');
  });

  it('grouped view (default) renders composite tree with ▾/├─/└─ glyphs', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/▾[^\n]*Card/);
    expect(out).toMatch(/├─ /);
  });

  it('[L] switches Column 1 to flat: no tree glyphs, one row per component', () => {
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
    expect(out).toContain('Card (2 deps)');
    expect(out).toContain('Icon');
    expect(out).toContain('Standalone');
    expect(out).toContain('Text');
  });

  it('[L] toggles between grouped and flat views', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('L');
    expect(lastFrame() ?? '').not.toMatch(/├─ /);
    stdin.write('L');
    expect(lastFrame() ?? '').toMatch(/├─ /);
  });

  it('cycle participants pin to the top in flat mode', () => {
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
    stdin.write('\x1b[B');
    const beforeToggle = lastFrame() ?? '';
    expect(beforeToggle).toMatch(/▶[^\n]*Icon/);
    stdin.write('L');
    const afterToggle = lastFrame() ?? '';
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
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CYCLE_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('a');
    stdin.write('j');
    stdin.write('a');
    const out = lastFrame() ?? '';
    expect(out).toContain('Added components');
    const cycleLine = out.split('\n').find((l) => /⚠ (Inner|Loopy)\b/.test(l));
    expect(cycleLine).toBeDefined();
  });

  it('places cycle members alphabetically at the top of Column 2 before non-cycle rows', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CYCLE_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('a');
    stdin.write('j');
    stdin.write('a');
    const out = lastFrame() ?? '';
    const innerPos = out.indexOf('⚠ Inner');
    const loopyPos = out.indexOf('⚠ Loopy');
    expect(innerPos).toBeGreaterThan(-1);
    expect(loopyPos).toBeGreaterThan(innerPos);
    const col2 = out
      .split('\n')
      .map((line) => {
        const parts = line.split('│');
        return parts.length >= 7 ? parts[3] : '';
      })
      .join('\n');
    const col2InnerPos = col2.indexOf('⚠ Inner');
    const col2LoopyPos = col2.indexOf('⚠ Loopy');
    // Match Column 2's non-cycle Card row specifically — Column 3 renders
    // "Card (1 dep)" (a group-root), so exclude the "(1 dep)" occurrence.
    const col2CardPos = col2.search(/\bCard(?!\s*\()/);
    expect(col2InnerPos).toBeGreaterThan(-1);
    expect(col2LoopyPos).toBeGreaterThan(col2InnerPos);
    expect(col2CardPos).toBeGreaterThan(col2LoopyPos);
  });
});

describe('ScopeGateStep — AI suggestions (three-column layout)', () => {
  it('surfaces the AI-recommended-exclusions hint + [x] goto-banner in wide layout', async () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={AI_FLAGGED_GRAPH}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const before = lastFrame() ?? '';
    expect(before).toContain('AI recommended exclusions');
    expect(before).toContain('[x]');
    expect(before).toContain('Added components');
    expect(before).toContain('Added groups');

    stdin.write('x');
    await new Promise((r) => setTimeout(r, 30));
    const out = lastFrame() ?? '';
    expect(out).toContain('DebugPanel');
    expect(out).toContain('internal-only debugging widget');
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
    expect(out).toContain('[×]');
    const sidebarLine = out
      .split('\n')
      .find((line) => line.includes('DebugPanel') && line.includes('[×]'));
    expect(sidebarLine).toBeDefined();
    expect(out).toContain('AI recommends');
  });

  it('renders [×] on AI-flagged accepted rows in the Added-components column', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={AI_FLAGGED_GRAPH}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    stdin.write('/');
    for (const ch of 'DebugPanel') stdin.write(ch);
    stdin.write('\r');
    stdin.write('a');
    const out = lastFrame() ?? '';
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
    stdin.write('a');
    const out = lastFrame() ?? '';
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
    stdin.write('A');
    stdin.write('/');
    for (const ch of 'DebugPanel') stdin.write(ch);
    stdin.write('\r');
    stdin.write('a');
    const out = lastFrame() ?? '';
    const addedRegion = out
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('│  ');
        return idx >= 0 ? line.slice(idx) : line;
      })
      .join('\n');
    expect(addedRegion).toMatch(/\s{4} Card\b/);
    expect(addedRegion).toMatch(/ \[×\] DebugPanel\b/);
  });
});
