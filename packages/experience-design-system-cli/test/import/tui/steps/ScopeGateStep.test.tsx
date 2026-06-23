import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep', () => {
  it('renders all component names', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={FIXTURE}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    expect(out).toContain('Junk');
  });

  it('calls onConfirm with all-accepted on f when no toggles happened', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('toggles selection with a and confirms with f', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Move down twice (j) to land on 'Junk' then 'a' to toggle off
    stdin.write('j');
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Card'],
      rejected: ['Junk'],
    });
  });

  it('A toggles all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // First A: all currently included → flip to all rejected
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: [],
      rejected: ['Button', 'Card', 'Junk'],
    });

    // Second A: all currently rejected → flip back to all accepted
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('r explicitly rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts at Button. Move down once to land on Card, then reject it.
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Junk'],
      rejected: ['Card'],
    });
  });

  it('F (capital) also confirms', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('F');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('calls onQuit on q', () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={onQuit} />,
    );
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

// ── Feature 3: AI-excluded section ────────────────────────────────────────────

describe('ScopeGateStep — AI-excluded section (Feature 3)', () => {
  const MIXED = [
    { name: 'Button', componentId: 'c0' },
    { name: 'Card', componentId: 'c1' },
    { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
    { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'no semantic content' },
    { name: 'Hero', componentId: 'c4' },
  ];

  it('renders the AI-excluded header with count when there are rejected components', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI excluded (2)');
    // Both excluded names + reasons appear (expanded by default).
    expect(out).toContain('BadgeIcon');
    expect(out).toContain('low semantic value');
    expect(out).toContain('DivWrapper');
    expect(out).toContain('no semantic content');
  });

  it('omits the section entirely when zero AI-rejected components', () => {
    const allAccepted = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const { lastFrame } = render(
      <ScopeGateStep
        components={allAccepted}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('AI excluded');
    expect(out).not.toContain('AI filtering');
  });

  it('renders the running header with progress counter when aiFilterStatus is running', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="running"
        aiFilterProgress={{ done: 2, total: 5 }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI filtering');
    expect(out).toContain('2/5');
  });

  it('renders a cancellation banner when aiFilterStatus is cancelled', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="cancelled"
        aiFilterProgress={{ done: 2, total: 5 }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI auto-filter cancelled');
  });

  it('renders a failure banner when aiFilterStatus is failed', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="failed"
        aiFilterError="agent crashed"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI auto-filter failed');
    expect(out).toContain('agent crashed');
  });

  it('renders <no reason given> for AI-rejected component without a reason', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          { name: 'Foo', componentId: 'c0' },
          { name: 'NoReason', componentId: 'c1', aiDecision: 'rejected', aiReason: null },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('NoReason');
    expect(out).toContain('no reason given');
  });

  it('collapses the AI-excluded section on c and re-expands on c again', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // Initially expanded — both reasons visible.
    expect(lastFrame() ?? '').toContain('low semantic value');
    stdin.write('c');
    // Collapsed: header still present, but reasons hidden.
    let out = lastFrame() ?? '';
    expect(out).toContain('AI excluded (2)');
    expect(out).not.toContain('low semantic value');
    stdin.write('c');
    out = lastFrame() ?? '';
    expect(out).toContain('low semantic value');
  });

  it('c is a no-op when there are no AI-excluded components', () => {
    const allAccepted = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={allAccepted}
        onConfirm={onConfirm}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    stdin.write('c');
    stdin.write('f');
    // f still works — the c keypress did not break anything.
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('f confirms with AI-rejected components in the rejected list (dual-write contract)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={onConfirm}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    // Main list (Button, Card, Hero) → accepted.
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Hero']));
    // AI-rejected (BadgeIcon, DivWrapper) → rejected, so they flow through
    // applyScopeDecisions / writeScopeDecisionsSnapshot. This pins the dual-
    // write invariant from commit 4b4a1ac.
    expect(arg.rejected).toEqual(expect.arrayContaining(['BadgeIcon', 'DivWrapper']));
  });

  it('q during auto-filter running calls onCancelAutoFilter, not onQuit', () => {
    const onQuit = vi.fn();
    const onCancelAutoFilter = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={onQuit}
        aiFilterStatus="running"
        aiFilterProgress={{ done: 1, total: 5 }}
        onCancelAutoFilter={onCancelAutoFilter}
      />,
    );
    stdin.write('q');
    expect(onCancelAutoFilter).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('q after auto-filter completes calls onQuit (existing behavior)', () => {
    const onQuit = vi.fn();
    const onCancelAutoFilter = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={onQuit}
        aiFilterStatus="complete"
        onCancelAutoFilter={onCancelAutoFilter}
      />,
    );
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onCancelAutoFilter).not.toHaveBeenCalled();
  });

  // ── Pilot-2026-06-23: cross-section navigation ──────────────────────────────
  // F3 originally simplified Task 6 to "cursor stays in main list, c toggles
  // collapse." Pilot testing surfaced that operators couldn't walk into the
  // AI-excluded section to read rejection reasons. These tests pin the new
  // cross-section behavior:
  //   - cursor logical order is [...mainList, ...excludedList]
  //   - initial cursor on first non-excluded row (mainList[0])
  //   - j past last main-list row enters excluded section top (e0)
  //   - k past first main-list row enters excluded section bottom (e_last)
  //   - a on excluded row un-excludes (moves to main list)
  //   - r on main row excludes (moves to AI-excluded)
  //   - collapsed section: j/k cannot enter it
  //   - s opens / closes the full reject_reason panel for the cursor row
  describe('cross-section navigation', () => {
    const MIXED = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
      { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
      { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'no semantic content' },
      { name: 'Hero', componentId: 'c4' },
    ];

    function cursorRow(frame: string): string | null {
      const lines = frame.split('\n');
      const r = lines.find((l) => l.includes('›'));
      return r ?? null;
    }

    it('initial cursor is on the first non-excluded row (Button)', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      const row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('Button');
    });

    it('j past the last main-list row enters the AI-excluded section (top)', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Main list (in order): Button, Card, Hero. Press j 3 times: B→C→H→excluded[0]=BadgeIcon.
      stdin.write('j');
      stdin.write('j');
      stdin.write('j');
      const row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('BadgeIcon');
    });

    it('k past the first main-list row enters the AI-excluded section (bottom)', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Cursor at Button (index 0). One k → DivWrapper (last excluded).
      stdin.write('k');
      const row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('DivWrapper');
    });

    it('collapsed AI-excluded section: j/k stay inside main list', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Collapse the excluded section.
      stdin.write('c');
      // Now press k from Button — should stay on Button (no wrap into excluded).
      stdin.write('k');
      let row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('Button');
      // Press j 3 times from Button — should land on Hero (last main-list row),
      // not enter the (collapsed) excluded section.
      stdin.write('j');
      stdin.write('j');
      stdin.write('j');
      row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('Hero');
    });

    it('a on AI-excluded row un-excludes it (moves to main list, included by default)', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Walk to BadgeIcon: j j j (Button → Card → Hero → BadgeIcon).
      stdin.write('j');
      stdin.write('j');
      stdin.write('j');
      // Un-exclude.
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      // BadgeIcon moved to main list AND defaulted to included.
      expect(arg.accepted).toContain('BadgeIcon');
      expect(arg.rejected).not.toContain('BadgeIcon');
      // DivWrapper was untouched and remains rejected.
      expect(arg.rejected).toContain('DivWrapper');
    });

    it('r on main-list row excludes it (moves to AI-excluded)', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Cursor on Button. r excludes Button.
      stdin.write('r');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toContain('Button');
      // Card and Hero remain included.
      expect(arg.accepted).toContain('Card');
      expect(arg.accepted).toContain('Hero');
    });

    it('s on AI-excluded row toggles the full reject_reason panel', () => {
      // Reason is >60 chars so it gets truncated inline, but short enough
      // that the panel renderer doesn't wrap it across lines.
      const longReason = 'low semantic value AND layout-only primitive — full reason text';
      // Sanity: longer than the inline truncation cap so the inline form
      // ends in an ellipsis, not the full string.
      expect(longReason.length).toBeGreaterThan(60);
      const FIXTURE = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: longReason },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Walk to BadgeIcon: j j (Button → Card → BadgeIcon).
      stdin.write('j');
      stdin.write('j');
      // Open source panel with full reason.
      stdin.write('s');
      let frame = lastFrame() ?? '';
      // Full reason visible (not truncated by …).
      expect(frame).toContain(longReason);
      // Press s again to close.
      stdin.write('s');
      frame = lastFrame() ?? '';
      // Panel header gone after toggle-off.
      expect(frame).not.toContain('AI rejection reason');
    });
  });

  it('shows yellow banner when ALL components are AI-rejected', () => {
    const allRejected = [
      { name: 'A', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: 'r1' },
      { name: 'B', componentId: 'c1', aiDecision: 'rejected' as const, aiReason: 'r2' },
    ];
    const { lastFrame } = render(
      <ScopeGateStep
        components={allRejected}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI excluded all components');
  });
});
