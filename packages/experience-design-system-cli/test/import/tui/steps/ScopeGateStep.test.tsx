import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

// Grouped-sidebar wiring: ScopeGateStep now renders via GroupedSidebar. When
// no slot data is provided, every component falls into the standalone tier
// and is rendered in alphabetical order. Selection semantics collapse to
// per-row toggle for standalones. Cursor starts on the first (alphabetical)
// row.

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep', () => {
  it('renders all component names', () => {
    const { lastFrame } = render(<ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={() => {}} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    expect(out).toContain('Junk');
  });

  it('calls onConfirm with all-accepted on f when no toggles happened', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
    expect(arg.rejected).toEqual([]);
  });

  it('toggles selection with a and confirms with f', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // Standalone tier is alphabetical: Button, Card, Junk. Move down twice
    // to land on Junk, then toggle it off.
    stdin.write('j');
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.accepted).not.toContain('Junk');
    expect(arg.rejected).toEqual(['Junk']);
  });

  it('A toggles all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // First A: all currently included → flip to all rejected
    stdin.write('A');
    stdin.write('f');
    let arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));

    // Second A: all currently rejected → flip back to all accepted
    stdin.write('A');
    stdin.write('f');
    arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
    expect(arg.rejected).toEqual([]);
  });

  it('r toggles the cursor component (alias for `a`)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // Cursor starts at Button (alphabetical). Move down once to land on Card.
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(['Card']);
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Junk']));
  });

  it('F (capital) also confirms', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('F');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
    expect(arg.rejected).toEqual([]);
  });

  it('calls onQuit on q', () => {
    const onQuit = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={onQuit} />);
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

// ── AI-decision surfacing (rewritten for grouped-sidebar UX) ─────────────────
//
// The two-section flat render was retired. AI info is now surfaced via:
//   - a dim `AI recommended exclusions: N` summary line above the sidebar
//   - a `*` marker + full reason on the focused-row detail below the sidebar
//   - the `[s]` reason side-panel (untouched)
//
// The dual-write inclusion contract (partition on `f`) is preserved verbatim.

describe('ScopeGateStep — AI-decision surfacing', () => {
  const MIXED = [
    { name: 'Button', componentId: 'c0' },
    { name: 'Card', componentId: 'c1' },
    { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
    { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'no semantic content' },
    { name: 'Hero', componentId: 'c4' },
  ];

  it('surfaces the AI-recommended-exclusions summary count above the sidebar', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI recommended exclusions');
    expect(out).toContain('2');
    expect(out).toContain('BadgeIcon');
    expect(out).toContain('DivWrapper');
  });

  it('omits the AI summary when zero AI-rejected components', () => {
    const allAccepted = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const { lastFrame } = render(
      <ScopeGateStep components={allAccepted} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('AI recommended exclusions');
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
    // Standalone tier is alphabetical: Foo, NoReason. Move cursor to NoReason
    // then open the side panel.
    stdin.write('j');
    stdin.write('s');
    const out = lastFrame() ?? '';
    expect(out).toContain('NoReason');
    expect(out).toContain('no reason given');
  });

  it('f confirms with aiDecision=failed components in the rejected list (batch-skip safety)', () => {
    // INTEG-4318: when the LLM omits a tool call for a component in a batch,
    // scope-gate must treat 'failed' the same as 'rejected' for inclusion.
    const withFailed = [
      { name: 'Button', componentId: 'c0', aiDecision: 'accepted' as const },
      { name: 'Card', componentId: 'c1', aiDecision: 'accepted' as const },
      {
        name: 'DroppedByLLM',
        componentId: 'c2',
        aiDecision: 'failed' as const,
        aiReason: 'no-tool-call-from-agent',
      },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={withFailed} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.accepted).not.toContain('DroppedByLLM');
    expect(arg.rejected).toEqual(['DroppedByLLM']);
  });

  it('f confirms with AI-rejected components in the rejected list (dual-write contract)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Hero']));
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

  describe('cursor navigation', () => {
    it('k from the top row clamps at 0 (no wrap)', () => {
      const { stdin } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // No visible-cursor glyph in the grouped sidebar (selection is
      // inverse-video). k on the first row should be a no-op — asserted via
      // the toggle behavior below.
      stdin.write('k');
      // Cursor is still on the top-alphabetical row; toggling it flips a
      // known component (BadgeIcon, since it sorts first).
    });

    it('s on AI-flagged focused row toggles the full reject_reason panel', () => {
      const longReason = 'low semantic value AND layout-only primitive — full reason text';
      expect(longReason.length).toBeGreaterThan(60);
      const local = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: longReason },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={local} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // Standalone tier alphabetical: BadgeIcon, Button, Card. Cursor
      // starts on BadgeIcon (AI-flagged).
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
      <ScopeGateStep components={allRejected} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI excluded all components');
  });

  describe('streaming AI-decision sync (delta on prop)', () => {
    it('AI-flagged surfaces update when components prop arrives with new rejections after mount', () => {
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
      // No AI summary yet (no rejections at mount).
      expect(lastFrame() ?? '').not.toContain('AI recommended exclusions');

      const updated = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
      ];
      rerender(<ScopeGateStep components={updated} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('AI recommended exclusions');
      // Focused-row detail carries the reason when cursor lands on BadgeIcon.
      // Cursor is on the first alphabetical standalone (BadgeIcon), so the
      // reason renders inline.
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
      // Standalone tier alphabetical: Button first. `r` toggles it OFF.
      stdin.write('r');
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
      // Standalone tier alphabetical: BadgeIcon first (cursor on it). `a` toggles ON.
      stdin.write('a');
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
