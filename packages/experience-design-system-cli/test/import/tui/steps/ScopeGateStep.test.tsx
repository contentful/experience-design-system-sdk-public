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

  it('r toggles the cursor component (alias for `a` in the unified model)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts at Button. Move down once to land on Card, then toggle.
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

// ── Pilot-2026-06-25: scope-gate UX overhaul — unified single-list model ─────
//
// The Feature 3 separate "AI excluded" section was removed. Every component
// renders in one ordered list with an INCLUDED/EXCLUDED word label and a
// persistent [AI] badge on rows the AI flagged. The cross-section navigation
// behavior, `c` collapse keybind, and r-as-reject semantics are gone.

describe('ScopeGateStep — unified AI behavior', () => {
  const MIXED = [
    { name: 'Button', componentId: 'c0' },
    { name: 'Card', componentId: 'c1' },
    { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
    { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'no semantic content' },
    { name: 'Hero', componentId: 'c4' },
  ];

  it('renders AI-flagged rows inline with [AI] badge and EXCLUDED label', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    // No separate "AI excluded (N)" section.
    expect(out).not.toMatch(/AI excluded \(\d+\)/);
    // Both AI-flagged components present with badge + reason (inline truncated).
    expect(out).toContain('BadgeIcon');
    expect(out).toContain('low semantic value');
    expect(out).toContain('DivWrapper');
    expect(out).toContain('no semantic content');
    // Rows preserve extraction order: Button, Card, BadgeIcon, DivWrapper, Hero.
    const lines = out.split('\n');
    const idx = (name: string) => lines.findIndex((l) => l.includes(name));
    expect(idx('Button')).toBeLessThan(idx('Card'));
    expect(idx('Card')).toBeLessThan(idx('BadgeIcon'));
    expect(idx('BadgeIcon')).toBeLessThan(idx('DivWrapper'));
    expect(idx('DivWrapper')).toBeLessThan(idx('Hero'));
  });

  it('omits the [AI] / [s] legend entry when zero AI-rejected components', () => {
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
    expect(out).not.toContain('[AI]');
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

  it('renders <no reason given> in the side panel for AI-rejected component without a reason', () => {
    const { lastFrame, stdin } = render(
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
    // Walk cursor to NoReason then open the side panel.
    stdin.write('j');
    stdin.write('s');
    const out = lastFrame() ?? '';
    expect(out).toContain('NoReason');
    expect(out).toContain('no reason given');
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
    // Non-AI rows → accepted.
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Hero']));
    // AI-rejected (BadgeIcon, DivWrapper) → rejected (dual-write invariant).
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

  // ── Pilot-2026-06-25: unified cursor navigation ──────────────────────────
  describe('cursor walks the unified flat list in extraction order', () => {
    function cursorRow(frame: string): string | null {
      const lines = frame.split('\n');
      const r = lines.find((l) => l.includes('›'));
      return r ?? null;
    }

    it('initial cursor is on the first row (Button)', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      const row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('Button');
    });

    it('j walks through AI-flagged rows inline', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('j');
      stdin.write('j');
      const row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      // Third row = BadgeIcon (AI-flagged).
      expect(row!).toContain('BadgeIcon');
    });

    it('k from the top row clamps at 0 (no wrap)', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('k');
      const row = cursorRow(lastFrame() ?? '');
      expect(row).not.toBeNull();
      expect(row!).toContain('Button');
    });

    it('a on AI-flagged row toggles it INCLUDED (badge stays)', () => {
      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Walk to BadgeIcon: Button → Card → BadgeIcon.
      stdin.write('j');
      stdin.write('j');
      stdin.write('a');
      const out = lastFrame() ?? '';
      // BadgeIcon now INCLUDED but still wears [AI] badge.
      expect(out).toMatch(/\[AI\][^\n]*INCLUDED[^\n]*BadgeIcon/);
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toContain('BadgeIcon');
      expect(arg.rejected).not.toContain('BadgeIcon');
      // DivWrapper untouched → still rejected.
      expect(arg.rejected).toContain('DivWrapper');
    });

    it('r on a non-AI row toggles it EXCLUDED', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('r'); // Toggle Button OFF.
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toContain('Button');
      expect(arg.accepted).toContain('Card');
      expect(arg.accepted).toContain('Hero');
    });

    it('s on AI-flagged row toggles the full reject_reason panel', () => {
      const longReason = 'low semantic value AND layout-only primitive — full reason text';
      expect(longReason.length).toBeGreaterThan(60);
      const FIXTURE = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: longReason },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Walk to BadgeIcon: Button → Card → BadgeIcon.
      stdin.write('j');
      stdin.write('j');
      stdin.write('s');
      let frame = lastFrame() ?? '';
      expect(frame).toContain('AI rejection reason');
      expect(frame).toContain(longReason);
      stdin.write('s');
      frame = lastFrame() ?? '';
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

  // ── Pilot-2026-06-23 R1 + R3a: streaming AI-decision prop sync ─────────────
  describe('streaming AI-decision sync (delta on prop)', () => {
    it('AI-flagged rows surface inline when components prop arrives with new rejections after mount', () => {
      const initial = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2' },
      ];
      const { lastFrame, rerender } = render(
        <ScopeGateStep
          components={initial}
          onConfirm={() => {}}
          onQuit={() => {}}
          aiFilterStatus="running"
          aiFilterProgress={{ done: 0, total: 3 }}
        />,
      );
      // No [AI] badges on mount.
      expect(lastFrame() ?? '').not.toContain('[AI]');

      const updated = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
      ];
      rerender(
        <ScopeGateStep
          components={updated}
          onConfirm={() => {}}
          onQuit={() => {}}
          aiFilterStatus="complete"
        />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/\[AI\][^\n]*BadgeIcon/);
      expect(frame).toContain('low semantic value');
    });

    it('operator r-exclude on a row survives a streaming prop re-render', () => {
      const initial = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
      ];
      const onConfirm = vi.fn();
      const { stdin, rerender } = render(
        <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="running" />,
      );
      stdin.write('r'); // toggle Button OFF
      rerender(
        <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('f');
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toContain('Button');
      expect(arg.accepted).toContain('Card');
    });

    it('operator a-include on AI-rejected row survives a subsequent prop re-render adding new rejections', () => {
      const initial = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'r1' },
      ];
      const onConfirm = vi.fn();
      const { stdin, rerender } = render(
        <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="running" />,
      );
      // Walk to BadgeIcon: Button → Card → BadgeIcon.
      stdin.write('j');
      stdin.write('j');
      stdin.write('a'); // toggle BadgeIcon ON
      const updated = [
        ...initial,
        { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'r2' },
      ];
      rerender(
        <ScopeGateStep components={updated} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toContain('BadgeIcon');
      expect(arg.rejected).not.toContain('BadgeIcon');
      expect(arg.rejected).toContain('DivWrapper');
    });
  });
});
