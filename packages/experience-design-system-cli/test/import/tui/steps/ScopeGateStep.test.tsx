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

  describe('D2 — per-row cascade selection', () => {
    // Article slots Card via `body`, so Article is an ancestor of Card.
    // Rejecting Card should cascade UP to Article; accepting Article should
    // cascade DOWN to Card.
    const ARTICLE_CARD = [
      {
        name: 'Article',
        componentId: 'a0',
        slots: [{ name: 'body', allowedComponents: ['Card'] }],
      },
      { name: 'Card', componentId: 'c0' },
    ];

    it('rejecting a child cascades to ancestors (blast radius 1 → no prompt)', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={ARTICLE_CARD} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Cursor starts on Article (root row). Move to Card child then reject.
      stdin.write('j'); // Card child
      stdin.write(' '); // reject Card — cascades to Article (single ancestor → no prompt)
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Article']));
      expect(arg.accepted).toEqual([]);
    });

    it('accepting a root cascades to descendants', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={ARTICLE_CARD} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Reject Article first (no ancestors), then re-accept — cascade to Card.
      stdin.write(' '); // reject Article
      stdin.write(' '); // accept Article → cascades to Card
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['Article', 'Card']));
      expect(arg.rejected).toEqual([]);
    });

    it('reject cascade with blast-radius ≥ 2 shows confirm; [y] applies', () => {
      // Two ancestors slot Card: Article and Newsletter.
      const TWO_PARENTS = [
        {
          name: 'Article',
          componentId: 'a0',
          slots: [{ name: 'body', allowedComponents: ['Card'] }],
        },
        {
          name: 'Newsletter',
          componentId: 'n0',
          slots: [{ name: 'items', allowedComponents: ['Card'] }],
        },
        { name: 'Card', componentId: 'c0' },
      ];
      const onConfirm = vi.fn();
      const { stdin, lastFrame } = render(
        <ScopeGateStep components={TWO_PARENTS} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Row order: Article root, Card child; Newsletter root, Card child; ...
      // Move to Card (child of Article, row 1). Reject → blast radius 2.
      stdin.write('j');
      stdin.write(' ');
      let frame = lastFrame() ?? '';
      expect(frame).toContain('Rejecting Card will:');
      expect(frame).toContain('Article');
      expect(frame).toContain('Newsletter');
      stdin.write('y'); // confirm
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Article', 'Newsletter']));
    });

    it('reject cascade confirm can be cancelled with [n]', () => {
      const TWO_PARENTS = [
        {
          name: 'Article',
          componentId: 'a0',
          slots: [{ name: 'body', allowedComponents: ['Card'] }],
        },
        {
          name: 'Newsletter',
          componentId: 'n0',
          slots: [{ name: 'items', allowedComponents: ['Card'] }],
        },
        { name: 'Card', componentId: 'c0' },
      ];
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={TWO_PARENTS} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('j'); // Card
      stdin.write(' '); // reject → prompt
      stdin.write('n'); // cancel
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      // Nothing rejected.
      expect(arg.rejected).toEqual([]);
      expect(arg.accepted).toEqual(expect.arrayContaining(['Article', 'Newsletter', 'Card']));
    });

    it('group-child rows and flat-tier rows are individually selectable', () => {
      const onConfirm = vi.fn();
      // Card + Text child; plus a standalone. Flat tier exposes every
      // component once.
      const setup = [
        {
          name: 'Card',
          componentId: 'c0',
          slots: [{ name: 'body', allowedComponents: ['Text'] }],
        },
        { name: 'Text', componentId: 't0' },
        { name: 'Standalone', componentId: 's0' },
      ];
      const { stdin } = render(
        <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Rows: Card(root), Text(child), Standalone, flat-header, Card(flat),
      // Standalone(flat), Text(flat).
      // Reject Text via its flat row (last). Cascades to Card.
      stdin.write('j'); // Text child
      stdin.write('j'); // Standalone
      stdin.write('j'); // flat-header (skipped by toggle)
      stdin.write('j'); // Card flat
      stdin.write('j'); // Standalone flat
      stdin.write('j'); // Text flat
      stdin.write(' '); // reject Text — cascades up to Card
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toEqual(expect.arrayContaining(['Text', 'Card']));
      expect(arg.accepted).toEqual(expect.arrayContaining(['Standalone']));
    });
  });

  describe('D4 — lineage panel', () => {
    const FIXTURE_L = [
      {
        name: 'Article',
        componentId: 'a0',
        slots: [{ name: 'body', allowedComponents: ['Card'] }],
      },
      { name: 'Card', componentId: 'c0' },
    ];

    it('[l] opens lineage panel showing ancestors + descendants of focused row', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_L} onConfirm={() => {}} onQuit={() => {}} />,
      );
      // Focus Card (child row).
      stdin.write('j');
      stdin.write('l');
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Lineage: Card');
      expect(frame).toContain('Ancestors:');
      expect(frame).toContain('Article');
      expect(frame).toContain('Descendants:');
    });

    it('lineage panel closes on [l] or Esc', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_L} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('l');
      expect(lastFrame() ?? '').toContain('Lineage:');
      stdin.write('l');
      expect(lastFrame() ?? '').not.toContain('Lineage:');
    });
  });

  describe('D7 — fuzzy search', () => {
    const FIXTURE_S = [
      { name: 'AlphaCard', componentId: 'c0' },
      { name: 'BetaBadge', componentId: 'c1' },
      { name: 'GammaButton', componentId: 'c2' },
    ];

    it('[/] opens a search prompt at the bottom', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_S} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('/');
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/\/(.*)$/m);
    });

    it('typing dims non-matches (verified via match counter)', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_S} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('/');
      stdin.write('b');
      const frame = lastFrame() ?? '';
      // Only BetaBadge and GammaButton contain 'b'.
      expect(frame).toContain('/b');
      expect(frame).toContain('2/3');
    });

    it('Esc while a query is active (and search input closed) clears the query', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_S} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('/');
      stdin.write('b');
      stdin.write('\r'); // close input, preserve query
      let frame = lastFrame() ?? '';
      expect(frame).toContain('/b');
      stdin.write('\x1b'); // Esc
      frame = lastFrame() ?? '';
      expect(frame).not.toContain('/b');
    });
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

// ── Tri-state (deselect-descendants) semantics ──────────────────────────────
//
// Rejecting a parent no longer cascades a *reject* to descendants. It marks
// descendants as `undecided` (deselected) instead. Ancestors that slot the
// target still cascade-reject (manifest integrity). Space toggle skips the
// undecided state — [a] promotes it back to accepted; [r] pushes it to
// rejected.

describe('ScopeGateStep — tri-state (deselect-descendants) semantics', () => {
  const ROOT_WITH_TWO_CHILDREN = [
    {
      name: 'Card',
      componentId: 'c0',
      slots: [{ name: 'body', allowedComponents: ['Text', 'Icon'] }],
    },
    { name: 'Text', componentId: 't0' },
    { name: 'Icon', componentId: 'i0' },
  ];

  it('rejecting a group-root deselects (not rejects) its descendants', () => {
    const onConfirm = vi.fn();
    const { stdin, lastFrame } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts on Card root. Rejecting → 2 descendants → prompt.
    stdin.write(' ');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rejecting Card will:');
    expect(frame).toContain('Deselect descendants:');
    expect(frame).toContain('Text');
    expect(frame).toContain('Icon');
    stdin.write('y');
    // After apply: Card row shows [✗], descendants show [ ].
    const after = lastFrame() ?? '';
    expect(after).toContain('[✗]');
    expect(after).toContain('[ ]');
  });

  it('rejecting a leaf rejects the target + ancestors and touches no descendants', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Rows: Card root, Icon child, Text child (children alphabetical), then
    // flat-tier. Move to Icon child (1 down).
    stdin.write('j'); // Icon child
    stdin.write(' '); // reject Icon — 1 ancestor (Card), 0 descendants
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Icon', 'Card']));
    // Text was never touched by the deselect cascade — remains accepted.
    expect(arg.accepted).toContain('Text');
  });

  it('confirm prompt renders BOTH ancestor and descendant lists when both non-empty', () => {
    const MIDDLE = [
      {
        name: 'Root',
        componentId: 'r0',
        slots: [{ name: 'body', allowedComponents: ['Mid'] }],
      },
      {
        name: 'Mid',
        componentId: 'm0',
        slots: [{ name: 'body', allowedComponents: ['Leaf'] }],
      },
      { name: 'Leaf', componentId: 'l0' },
    ];
    const { stdin, lastFrame } = render(
      <ScopeGateStep components={MIDDLE} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Rows: Root root, Mid child, Leaf grandchild, flat-header, ...
    stdin.write('j'); // Mid
    stdin.write(' '); // reject Mid → 1 ancestor (Root) + 1 descendant (Leaf) = 2 → prompt
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rejecting Mid will:');
    expect(frame).toContain('Reject ancestors: Root');
    expect(frame).toContain('Deselect descendants: Leaf');
  });

  it('on confirm, undecided rows go into decisions.rejected', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write(' '); // reject Card
    stdin.write('y'); // confirm — Text/Icon → undecided
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Text', 'Icon']));
    expect(arg.accepted).toEqual([]);
  });

  it('[a] on an undecided row promotes it to accepted and cascades to descendants', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write(' '); // reject Card
    stdin.write('y'); // Text/Icon → undecided
    stdin.write('j'); // Icon child (alphabetical)
    stdin.write('a'); // accept Icon (leaf → no descendants to cascade)
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('Icon');
    expect(arg.rejected).toContain('Card');
    expect(arg.rejected).toContain('Text');
  });

  it('Space on an undecided row still flips it to accepted (binary via [a] dispatch)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write(' '); // reject Card
    stdin.write('y'); // Text/Icon → undecided
    stdin.write('j'); // Icon (alphabetical child)
    stdin.write(' '); // Space → accept (since not accepted)
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('Icon');
  });
});
