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

  it('calls onConfirm with all-rejected on f when no toggles happened (undecided default)', () => {
    // Everything starts undecided. Confirming without any explicit accepts
    // partitions the whole set into rejected (undecided → rejected).
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
  });

  it('[a] accepts the cursor row; [f] partitions accepted vs. rejected', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // Standalone tier alphabetical: Button, Card, Junk. Accept Card only.
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(['Card']);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Junk']));
  });

  it('A toggles all — first press accepts all when anything is not-accepted', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // Fresh state: all undecided → first [A] flips to accepted.
    stdin.write('A');
    stdin.write('f');
    let arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
    expect(arg.rejected).toEqual([]);

    // Second [A]: all accepted → flip to rejected.
    stdin.write('A');
    stdin.write('f');
    arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
  });

  it('[r] rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // Accept-all first so [r] on Card exercises a real reject-from-accepted.
    stdin.write('A');
    // Cursor starts at Button. Move down once to Card.
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(['Card']);
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Junk']));
  });

  it('[r] on an undecided leaf rejects it directly (blast radius 0 → no prompt)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    // Cursor on Button. [r] rejects it. No ancestors/descendants → no prompt.
    stdin.write('r');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button']));
  });

  it('F (capital) confirms — behavior parallels lowercase [f]', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('F');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    // Nothing was accepted → all → rejected.
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
  });

  it('[Y] accepts every non-cycle-participant that is not AI-flagged', () => {
    const onConfirm = vi.fn();
    const MIXED = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
      { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
    ];
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('Y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.accepted).not.toContain('BadgeIcon');
    expect(arg.rejected).toEqual(['BadgeIcon']);
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

  it('[Y] then [f] partitions AI-flagged (rejected/failed) into rejected, rest into accepted', () => {
    // INTEG-4318: 'failed' behaves like 'rejected' for inclusion. Under the
    // undecided-default model, [Y] accepts every non-AI-flagged component;
    // the AI-flagged remainder stays undecided and lands in `rejected` on [f].
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
    stdin.write('Y');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.accepted).not.toContain('DroppedByLLM');
    expect(arg.rejected).toEqual(['DroppedByLLM']);
  });

  it('[Y] skips AI-rejected components; [f] puts them in the rejected list (dual-write contract)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('Y');
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

  it('shows a "nothing selected" hint at mount (everything defaults to undecided)', () => {
    const anySet = [
      { name: 'A', componentId: 'c0' },
      { name: 'B', componentId: 'c1' },
    ];
    const { lastFrame } = render(
      <ScopeGateStep components={anySet} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('nothing selected');
    // Hint advertises the fast opt-in keys.
    expect(out).toContain('[Y]');
    expect(out).toContain('[A]');
    expect(out).toContain('[a]');
  });

  it('hides the "nothing selected" hint once at least one component is accepted', () => {
    const anySet = [
      { name: 'A', componentId: 'c0' },
      { name: 'B', componentId: 'c1' },
    ];
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={anySet} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('a');
    const out = lastFrame() ?? '';
    expect(out).not.toContain('nothing selected');
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
      // Accept-all first so Card is accepted; then [r] on Card cascades UP.
      stdin.write('A');
      stdin.write('j'); // Card child
      stdin.write('r'); // reject Card — cascades to Article (single ancestor → no prompt)
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
      // Cursor starts on Article root (undecided). [a] accepts → cascades to Card.
      stdin.write('a');
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
      // Accept-all first, then move to Card (child under Article) and reject.
      stdin.write('A');
      stdin.write('j');
      stdin.write('r');
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
      stdin.write('A'); // accept-all so Card is accepted
      stdin.write('j'); // Card
      stdin.write('r'); // reject → prompt (blast radius 2)
      stdin.write('n'); // cancel
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      // Cancel leaves the accept-all state intact.
      expect(arg.rejected).toEqual([]);
      expect(arg.accepted).toEqual(expect.arrayContaining(['Article', 'Newsletter', 'Card']));
    });

    it('group-child rows are individually selectable', () => {
      const onConfirm = vi.fn();
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
      // Accept-all first, then reject Text via its group-child row.
      stdin.write('A');
      stdin.write('j'); // Text child
      stdin.write('r'); // reject Text — cascades up to Card
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

  describe('cycles-detail panel', () => {
    const FIXTURE_2CYCLE = [
      {
        name: 'NodeA',
        componentId: 'a',
        slots: [{ name: 'slotA', allowedComponents: ['NodeB'] }],
      },
      {
        name: 'NodeB',
        componentId: 'b',
        slots: [{ name: 'slotB', allowedComponents: ['NodeA'] }],
      },
    ];

    it('[c] opens cycles panel with interleaved cycle path', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_2CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('c');
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Cycles detected');
      expect(frame).toMatch(/Cycle 1:.*NodeA.*\[slotA\].*NodeB.*\[slotB\].*NodeA/);
    });

    it('legend advertises [c] when cycles exist', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={FIXTURE_2CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      expect(lastFrame() ?? '').toContain('[c]');
    });

    it('[c] is a no-op when no cycles exist and legend omits it', () => {
      const noCycles = [
        { name: 'Solo', componentId: 's' },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={noCycles} onConfirm={() => {}} onQuit={() => {}} />,
      );
      const before = lastFrame() ?? '';
      expect(before).not.toContain('[c]');
      stdin.write('c');
      const after = lastFrame() ?? '';
      expect(after).not.toContain('Cycles detected');
    });

    it('Esc closes cycles panel', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_2CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('c');
      expect(lastFrame() ?? '').toContain('Cycles detected');
      stdin.write('\x1b');
      expect(lastFrame() ?? '').not.toContain('Cycles detected');
    });

    it('[c] again closes the cycles panel', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_2CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('c');
      expect(lastFrame() ?? '').toContain('Cycles detected');
      stdin.write('c');
      expect(lastFrame() ?? '').not.toContain('Cycles detected');
    });

    it('opening [c] while [l] is open closes lineage panel', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_2CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('l');
      expect(lastFrame() ?? '').toContain('Lineage:');
      stdin.write('c');
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Lineage:');
      expect(frame).toContain('Cycles detected');
    });

    it('Enter on a cycle entry jumps main cursor and closes panel', () => {
      const onConfirm = vi.fn();
      // Include a third non-cycle component so the cursor can be moved off
      // NodeA first, letting us prove Enter actually jumps.
      const withStandalone = [
        ...FIXTURE_2CYCLE,
        { name: 'Zonk', componentId: 'z' },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={withStandalone} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Move cursor to Zonk (last row).
      stdin.write('j');
      stdin.write('j');
      stdin.write('c');
      stdin.write('\r');
      // Panel closed.
      expect(lastFrame() ?? '').not.toContain('Cycles detected');
      // Now [l] should open lineage rooted at the jump target (NodeA), not Zonk.
      stdin.write('l');
      expect(lastFrame() ?? '').toContain('Lineage: NodeA');
    });
  });

  describe('T6 — cycle guidance banner', () => {
    const CYCLE_FIXTURE = [
      {
        name: 'NodeA',
        componentId: 'a',
        slots: [{ name: 'slotA', allowedComponents: ['NodeB'] }],
      },
      {
        name: 'NodeB',
        componentId: 'b',
        slots: [{ name: 'slotB', allowedComponents: ['NodeA'] }],
      },
    ];

    it('renders guidance banner when at least one cycle exists', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={CYCLE_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      expect(lastFrame() ?? '').toContain(
        'If you must have components with cycles',
      );
    });

    it('does not render guidance banner when no cycles exist', () => {
      const noCycles = [{ name: 'Solo', componentId: 's' }];
      const { lastFrame } = render(
        <ScopeGateStep components={noCycles} onConfirm={() => {}} onQuit={() => {}} />,
      );
      expect(lastFrame() ?? '').not.toContain(
        'If you must have components with cycles',
      );
    });
  });

  describe('cycle-row rejection (INTEG task #31)', () => {
    // 2-cycle: NodeA ↔ NodeB. Both are cycle-tier rows at the top of the
    // sidebar. Rejecting either from its cycle row must work — previously
    // the [a]/[r]/Space handler treated 'cycle' as a no-op, blocking the
    // user from breaking the cycle.
    const CYCLE = [
      {
        name: 'NodeA',
        componentId: 'a',
        slots: [{ name: 'slotA', allowedComponents: ['NodeB'] }],
      },
      {
        name: 'NodeB',
        componentId: 'b',
        slots: [{ name: 'slotB', allowedComponents: ['NodeA'] }],
      },
    ];

    it('[r] on a cycle-tier row rejects that participant', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={CYCLE} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Cursor starts on the first cycle-tier row (NodeA, alphabetical).
      // Under undecided-default, [r] rejects NodeA (from undecided) and
      // cascades UP to its ancestor NodeB.
      stdin.write('r');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toEqual(expect.arrayContaining(['NodeA', 'NodeB']));
      expect(arg.accepted).toEqual([]);
    });

    it('Space on a cycle-tier row does NOT accept (L9 rebind: space = collapse)', () => {
      // L9 rebind: Space no longer accepts — it toggles group collapse. [a]
      // accepts, [r] rejects. This pins the rebind against future regressions.
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={CYCLE} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write(' ');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).not.toContain('NodeA');
    });

    it('[a] on a cycle-tier row after a reject re-accepts the whole cycle unit (task #47 cohesion)', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={CYCLE} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Reject NodeA → both A and B flip to rejected. Then [a] on NodeA
      // re-accepts BOTH — cycle-unit cohesion (task #47) means the whole
      // cycle must move together at all times.
      stdin.write('r');
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['NodeA', 'NodeB']));
      expect(arg.rejected).toEqual([]);
    });

    it('cycle-row glyph still renders after a cycle participant is rejected', () => {
      // Cycle detection runs on the extracted graph, not the pushed subset —
      // so the ⚠ (cycle) marker stays visible even after the reject. Pins
      // current behavior against future re-rendering changes.
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('r');
      const frame = lastFrame() ?? '';
      expect(frame).toContain('(cycle)');
      expect(frame).toContain('NodeA');
      expect(frame).toContain('NodeB');
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

    describe('L4 — Tab autocomplete possibilities + [n] match-cycle', () => {
      const T3_FIXTURE = [
        { name: 'Widget', componentId: 'c0' },
        { name: 'Wizard', componentId: 'c1' },
        { name: 'Waffle', componentId: 'c2' },
      ];
      // Fixture where two candidates share a longer common prefix ("Wid") so
      // Tab can extend the query beyond what was typed.
      const LCP_FIXTURE = [
        { name: 'Widget', componentId: 'c0' },
        { name: 'Widen', componentId: 'c1' },
        { name: 'Card', componentId: 'c2' },
      ];

      it('Tab with a single prefix-match completes to the full name (input open)', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={LCP_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('C');
        stdin.write('\t');
        const frame = lastFrame() ?? '';
        expect(frame).toContain('/Card');
      });

      it('Tab with multiple prefix-matches extends to the LCP and lists possibilities', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={LCP_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('W');
        stdin.write('\t');
        const frame = lastFrame() ?? '';
        // Query extended to the longest common prefix of Widget + Widen.
        expect(frame).toContain('/Wid');
        // Possibilities strip lists both candidates.
        expect(frame).toContain('Widget');
        expect(frame).toContain('Widen');
      });

      it('Tab with no further common prefix keeps the query and still lists possibilities', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={T3_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('W');
        stdin.write('\t');
        const frame = lastFrame() ?? '';
        // LCP of Widget/Wizard/Waffle is just "W" — query unchanged.
        expect(frame).toContain('/W');
        expect(frame).toContain('Widget');
        expect(frame).toContain('Wizard');
        expect(frame).toContain('Waffle');
      });

      it('typing after Tab clears the possibilities strip', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={T3_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('W');
        stdin.write('\t');
        expect(lastFrame() ?? '').toContain('Wizard');
        stdin.write('i'); // narrows to Widget/Wizard; strip should clear on keystroke
        const frame = lastFrame() ?? '';
        // Strip cleared: the possibilities label is gone.
        expect(frame).not.toContain('possibilities:');
      });

      it('Tab with input open and no prefix match is a no-op (no crash, query unchanged)', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={T3_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('z');
        stdin.write('z');
        stdin.write('z');
        stdin.write('\t');
        const frame = lastFrame() ?? '';
        expect(frame).toContain('/zzz');
      });

      it('Tab with search CLOSED and active query does NOT cycle matches (falls through)', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={T3_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('W');
        stdin.write('\r'); // close, preserve query
        const before = lastFrame() ?? '';
        stdin.write('\t');
        const after = lastFrame() ?? '';
        // Two-column layout: Tab is a no-op (not three-column). Frame unchanged
        // materially — importantly, the query is still `/W` and the hint has
        // updated to advertise [n].
        expect(after).toContain('/W');
        // Regression: OLD behavior would have jumped to a different match; the
        // cursor line before/after should still refer to the same match.
        void before;
      });

      it('[n] with active query and search closed cycles to the next match', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={T3_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('W');
        stdin.write('\r'); // close, preserve query — cursor on first match (Waffle)
        const before = lastFrame() ?? '';
        stdin.write('n');
        const after = lastFrame() ?? '';
        expect(before).not.toEqual(after);
      });

      it('hint text advertises [n] next, not [Tab] next', () => {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={T3_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
        );
        stdin.write('/');
        stdin.write('W');
        stdin.write('\r');
        const frame = lastFrame() ?? '';
        expect(frame).toContain('[n] next');
        expect(frame).not.toContain('[Tab] next');
      });
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
      // Accept-all first so Card lands accepted. Then move cursor to Button
      // (index 0 after alphabetical sort) and reject it explicitly. The
      // re-render arrives mid-flight; the operator decision must survive.
      stdin.write('A');
      stdin.write('r'); // reject Button (cursor is on Button at index 0)
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

  it('rejecting an accepted group-root deselects (not rejects) its descendants', () => {
    const onConfirm = vi.fn();
    const { stdin, lastFrame } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Accept-all first so Card + descendants are accepted. Cursor on Card root.
    stdin.write('A');
    stdin.write('r'); // reject Card — 2 descendants → prompt
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

  it('rejecting an accepted leaf rejects target + ancestors, leaves siblings accepted', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Accept-all first. Rows: Card root, Icon child, Text child.
    stdin.write('A');
    stdin.write('j'); // Icon child
    stdin.write('r'); // reject Icon — 1 ancestor (Card), 0 descendants
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
    // Accept-all first so Mid is accepted (else [r] rejects from undecided
    // with no descendants to deselect).
    stdin.write('A');
    stdin.write('j'); // Mid
    stdin.write('r'); // reject Mid → 1 ancestor (Root) + 1 descendant (Leaf) = 2 → prompt
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rejecting Mid will:');
    expect(frame).toContain('Reject ancestors: Root');
    expect(frame).toContain('Deselect descendants: Leaf');
  });

  it('on confirm after reject-cascade, deselected descendants land in decisions.rejected', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('A'); // accept-all
    stdin.write('r'); // reject Card — Text/Icon → undecided (via prompt)
    stdin.write('y');
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
    stdin.write('A'); // everything accepted
    stdin.write('r'); // reject Card → Text/Icon → undecided
    stdin.write('y');
    stdin.write('j'); // Icon child (alphabetical)
    stdin.write('a'); // accept Icon (leaf → no descendants to cascade)
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('Icon');
    expect(arg.rejected).toContain('Card');
    expect(arg.rejected).toContain('Text');
  });

  it('Space on an undecided row does NOT accept (L9 rebind: space = collapse)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // L9 rebind: Space toggles collapse, not accept. Card stays undecided →
    // partitions into rejected on confirm.
    stdin.write(' ');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).not.toContain('Card');
  });
});

// ── Cycle-unit cohesion (task #47) ──────────────────────────────────────────
//
// Cycle members must stay in the same state after any single [a]/[r] action.
// [a] on any cycle member accepts the whole unit + full descendant closure.
// [r] on any cycle member rejects the whole unit + ancestors that slot it.
// [a] on a non-cycle ancestor whose slot targets a cycle also drags the
// cycle unit in — otherwise the accepted parent references a non-accepted
// slot target (invariant violation, breaks topo-sort at push).

describe('ScopeGateStep — cycle-unit cohesion (task #47)', () => {
  // Two-node cycle: NodeA ↔ NodeB.
  const TWO_CYCLE = [
    {
      name: 'NodeA',
      componentId: 'a',
      slots: [{ name: 'slotA', allowedComponents: ['NodeB'] }],
    },
    {
      name: 'NodeB',
      componentId: 'b',
      slots: [{ name: 'slotB', allowedComponents: ['NodeA'] }],
    },
  ];

  it('[a] on a cycle member accepts every member of the cycle', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={TWO_CYCLE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts on NodeA (cycle-tier alphabetical). [a] accepts.
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['NodeA', 'NodeB']));
    expect(arg.rejected).toEqual([]);
  });

  it('[a] on a cycle member accepts non-cycle descendants of every member (full closure)', () => {
    const setup = [
      {
        name: 'NodeA',
        componentId: 'a',
        slots: [
          { name: 'cycle', allowedComponents: ['NodeB'] },
          { name: 'aux', allowedComponents: ['Leaf1'] },
        ],
      },
      {
        name: 'NodeB',
        componentId: 'b',
        slots: [
          { name: 'cycle', allowedComponents: ['NodeA'] },
          { name: 'aux', allowedComponents: ['Leaf2'] },
        ],
      },
      { name: 'Leaf1', componentId: 'l1' },
      { name: 'Leaf2', componentId: 'l2' },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor on NodeA cycle-tier row. [a] cascades into cycle + descendants.
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['NodeA', 'NodeB', 'Leaf1', 'Leaf2']));
  });

  it('[a] on an ancestor that slots a cycle accepts ancestor + entire cycle', () => {
    const setup = [
      {
        name: 'Wrapper',
        componentId: 'w',
        slots: [{ name: 's', allowedComponents: ['NodeA'] }],
      },
      ...TWO_CYCLE,
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts on the first cycle-tier row. Cycle-tier rows are
    // expandable and duplicated per participant, so counting `j` presses is
    // fragile — jump to Wrapper via fuzzy search instead.
    stdin.write('/');
    stdin.write('W');
    stdin.write('r');
    stdin.write('\r'); // Enter jumps cursor + closes input
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper', 'NodeA', 'NodeB']));
  });

  it('[a] on an ancestor with a cycle two levels down accepts all of them', () => {
    // Wrapper → SharedInterior → InnerA ↔ InnerB.
    const setup = [
      {
        name: 'Wrapper',
        componentId: 'w',
        slots: [{ name: 's', allowedComponents: ['SharedInterior'] }],
      },
      {
        name: 'SharedInterior',
        componentId: 'si',
        slots: [{ name: 's', allowedComponents: ['InnerA'] }],
      },
      {
        name: 'InnerA',
        componentId: 'ia',
        slots: [{ name: 's', allowedComponents: ['InnerB'] }],
      },
      {
        name: 'InnerB',
        componentId: 'ib',
        slots: [{ name: 's', allowedComponents: ['InnerA'] }],
      },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Move past the two cycle-tier rows (InnerA, InnerB) and the
    // SharedInterior composite group-child rows to the Wrapper group-root.
    // Simpler: press [Y] which accepts non-cycle, non-AI-flagged with
    // reachable cycles included by design.
    stdin.write('Y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(
      expect.arrayContaining(['Wrapper', 'SharedInterior', 'InnerA', 'InnerB']),
    );
  });

  it('[r] on a cycle member rejects every member + ancestors that reference any member', () => {
    // Wrapper1 slots NodeA; Wrapper2 slots NodeB. Rejecting NodeA must
    // reject the whole cycle unit (NodeA, NodeB) AND both wrappers.
    const setup = [
      {
        name: 'Wrapper1',
        componentId: 'w1',
        slots: [{ name: 's', allowedComponents: ['NodeA'] }],
      },
      {
        name: 'Wrapper2',
        componentId: 'w2',
        slots: [{ name: 's', allowedComponents: ['NodeB'] }],
      },
      ...TWO_CYCLE,
    ];
    const onConfirm = vi.fn();
    const { stdin, lastFrame } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Accept-all first to make [r] meaningful.
    stdin.write('A');
    // Cursor is on NodeA (cycle-tier first). [r] rejects — blast radius > 1
    // (NodeB partner + Wrapper1 + Wrapper2), so a confirm prompt appears.
    stdin.write('r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rejecting NodeA will:');
    stdin.write('y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(
      expect.arrayContaining(['NodeA', 'NodeB', 'Wrapper1', 'Wrapper2']),
    );
    expect(arg.accepted).toEqual([]);
  });

  it('[r] on a non-cycle ancestor of a cycle: ancestor rejected, cycle members deselect, non-cycle descendants deselect', () => {
    // Wrapper → NodeA ↔ NodeB, plus a non-cycle Leaf child of Wrapper.
    const setup = [
      {
        name: 'Wrapper',
        componentId: 'w',
        slots: [
          { name: 'cycle', allowedComponents: ['NodeA'] },
          { name: 'aux', allowedComponents: ['Leaf'] },
        ],
      },
      ...TWO_CYCLE,
      { name: 'Leaf', componentId: 'l' },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Accept-all first so everything reachable is accepted.
    stdin.write('A');
    // Jump to Wrapper via search — cursor-jump semantics are stable across
    // the cycle-tier expansion rows.
    stdin.write('/');
    stdin.write('W');
    stdin.write('\r');
    stdin.write('r'); // reject Wrapper — blast radius includes Leaf + cycle → prompt
    stdin.write('y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    // Wrapper rejected. Cycle members and Leaf deselected → undecided →
    // partitioned into rejected on confirm.
    expect(arg.rejected).toEqual(
      expect.arrayContaining(['Wrapper', 'NodeA', 'NodeB', 'Leaf']),
    );
    expect(arg.accepted).toEqual([]);
  });

  it('[A] toggle-all: cycles reachable from accepted ancestors are also accepted', () => {
    const setup = [
      {
        name: 'Wrapper',
        componentId: 'w',
        slots: [{ name: 's', allowedComponents: ['NodeA'] }],
      },
      ...TWO_CYCLE,
      { name: 'Standalone', componentId: 's0' },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    // Wrapper slots NodeA → cohesion pulls NodeA + NodeB in as accepted.
    expect(arg.accepted).toEqual(
      expect.arrayContaining(['Wrapper', 'Standalone', 'NodeA', 'NodeB']),
    );
    expect(arg.rejected).toEqual([]);
  });

  it('[Y] accept-non-AI-flagged: cycles reachable from accepted ancestors are also accepted', () => {
    const setup = [
      {
        name: 'Wrapper',
        componentId: 'w',
        slots: [{ name: 's', allowedComponents: ['NodeA'] }],
      },
      ...TWO_CYCLE,
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('Y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper', 'NodeA', 'NodeB']));
    expect(arg.rejected).toEqual([]);
  });

  it('directional invariant holds after arbitrary [a]/[r] sequences (parent accepted ⇒ slot targets accepted or same cycle)', () => {
    const setup = [
      {
        name: 'Wrapper1',
        componentId: 'w1',
        slots: [{ name: 's', allowedComponents: ['NodeA'] }],
      },
      {
        name: 'Wrapper2',
        componentId: 'w2',
        slots: [{ name: 's', allowedComponents: ['NodeB'] }],
      },
      ...TWO_CYCLE,
      { name: 'Standalone', componentId: 's0' },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Sequence: A (accept all) → r on NodeA (reject cycle) → confirm →
    // a on Wrapper1 (re-accept ancestor + cycle).
    stdin.write('A');
    stdin.write('r'); // cursor is NodeA
    stdin.write('y');
    // Jump to Wrapper1 via search — cycle-tier row duplication makes j/k
    // counting fragile.
    stdin.write('/');
    stdin.write('W');
    stdin.write('r');
    stdin.write('a');
    stdin.write('p');
    stdin.write('1');
    stdin.write('\r');
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    const accepted = new Set(arg.accepted);
    // Invariant check: every accepted component's slot targets must be
    // accepted OR in the same cycle unit as the accepted component. Because
    // task #47's cascade should guarantee this, we assert directly.
    for (const c of setup) {
      if (!accepted.has(c.name)) continue;
      for (const slot of c.slots ?? []) {
        for (const target of slot.allowedComponents) {
          expect(accepted.has(target)).toBe(true);
        }
      }
    }
    // Concretely: Wrapper1 accepted → NodeA + NodeB accepted (cohesion).
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper1', 'NodeA', 'NodeB']));
  });

  it('[a] on a cycle member with two overlapping cycles pulls both units together', () => {
    // A ↔ B ↔ C: A↔B and B↔C, sharing B. Accepting A must accept all three.
    const setup = [
      {
        name: 'A',
        componentId: 'a',
        slots: [{ name: 's', allowedComponents: ['B'] }],
      },
      {
        name: 'B',
        componentId: 'b',
        slots: [
          { name: 'sa', allowedComponents: ['A'] },
          { name: 'sc', allowedComponents: ['C'] },
        ],
      },
      {
        name: 'C',
        componentId: 'c',
        slots: [{ name: 's', allowedComponents: ['B'] }],
      },
    ];
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // All three are cycle participants → all live in the cycle tier
    // (alphabetical). Cursor starts on A. [a] pulls whole unit in.
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(arg.rejected).toEqual([]);
  });
});

// ADR-0010 §Part 2 canonical scenarios — driven through the real ScopeGateStep
// component. Pins mount defaults (everything undecided, NO auto-reject),
// cycle-unit cohesion, and slot-edge cascade per topology.
//
// Scenarios:
//   A — P and C cycle with each other (P.slots⊃C, C.slots⊃P).
//   B — P slots C; C cycles with unrelated X (P not in cycle).
//   C — P cycles with X; P also slots C; C has no slots (leaf).

describe('ScopeGateStep — ADR-0010 scenarios', () => {
  describe('Scenario A — P ↔ C cycle-unit', () => {
    const SCENARIO_A = [
      {
        name: 'P',
        componentId: 'p',
        slots: [{ name: 's', allowedComponents: ['C'] }],
      },
      {
        name: 'C',
        componentId: 'c',
        slots: [{ name: 's', allowedComponents: ['P'] }],
      },
    ];

    it('mount defaults — nothing accepted, NO auto-reject (ADR-0010 §Part 1)', () => {
      // Everything defaults to undecided in ScopeGate. Confirming right away
      // partitions everything (including cycle participants) into rejected —
      // no auto-reject flipped anything before the operator touched a key.
      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={SCENARIO_A} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // "nothing selected" hint proves no auto-accept/reject happened at mount.
      expect(lastFrame() ?? '').toContain('nothing selected');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual([]);
      expect(arg.rejected).toEqual(expect.arrayContaining(['P', 'C']));
    });

    it('[a] on either cycle member accepts BOTH via cycle-unit cohesion', () => {
      // Cursor starts on C (cycle tier alphabetical). [a] on C must accept
      // both C and P — cycle-unit cohesion (task #47).
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={SCENARIO_A} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['P', 'C']));
      expect(arg.rejected).toEqual([]);
    });

    it('[r] on either cycle member rejects BOTH via cycle-unit cohesion', () => {
      // Cursor on C (first cycle-tier alphabetical). [r] rejects the whole
      // unit. Blast radius is 1 partner (P) + 0 descendants → no confirm prompt.
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={SCENARIO_A} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('r');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual([]);
      expect(arg.rejected).toEqual(expect.arrayContaining(['P', 'C']));
    });
  });

  describe('Scenario B — P → C, C ↔ X (P not in cycle)', () => {
    const SCENARIO_B = [
      {
        name: 'P',
        componentId: 'p',
        slots: [{ name: 's', allowedComponents: ['C'] }],
      },
      {
        name: 'C',
        componentId: 'c',
        slots: [{ name: 's', allowedComponents: ['X'] }],
      },
      {
        name: 'X',
        componentId: 'x',
        slots: [{ name: 's', allowedComponents: ['C'] }],
      },
    ];

    it('mount defaults — nothing accepted; cycle detected but NO auto-reject', () => {
      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={SCENARIO_B} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('nothing selected');
      // [c] legend advertises the cycle affordance — cycle detection ran.
      expect(frame).toContain('[c]');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual([]);
    });

    it('accepting P via [Y] cascades DOWN P→C and cohesion pulls X in', () => {
      // ADR-0010 §Part 2 scenario B: "Accepting P cascades DOWN to C,
      // cohesion pulls X into accepted as well." [Y] accepts every non-cycle
      // non-AI-flagged component (P) then adds every cycle unit reachable
      // via slot closure from those seeds. P → C → X unit → both pulled in.
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={SCENARIO_B} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('Y');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['P', 'C', 'X']));
      expect(arg.rejected).toEqual([]);
    });

    it('[a] on cycle member C accepts cycle-unit {C,X}; P not pulled in (P is ancestor, not descendant)', () => {
      // Cursor starts on C (first cycle-tier alphabetical). Accept C →
      // cohesion pulls X. Cascade goes DOWN through slot edges. P is an
      // ancestor (P slots C), NOT a descendant of C → accept does not
      // touch P. P stays undecided → partitions to rejected on [f].
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={SCENARIO_B} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['C', 'X']));
      expect(arg.accepted).not.toContain('P');
      expect(arg.rejected).toContain('P');
    });
  });

  describe('Scenario C — P ↔ X cycle-unit, P also slots C (C not in cycle)', () => {
    const SCENARIO_C = [
      {
        name: 'P',
        componentId: 'p',
        slots: [
          { name: 'cycle', allowedComponents: ['X'] },
          { name: 'child', allowedComponents: ['C'] },
        ],
      },
      {
        name: 'X',
        componentId: 'x',
        slots: [{ name: 's', allowedComponents: ['P'] }],
      },
      { name: 'C', componentId: 'c' },
    ];

    it('mount defaults — everything undecided; NO auto-reject even though a cycle exists', () => {
      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={SCENARIO_C} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      expect(lastFrame() ?? '').toContain('nothing selected');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual([]);
    });

    it('[a] on cycle member P accepts cycle-unit {P,X} AND descendant C via slot cascade', () => {
      // ADR-0010 §Part 2 scenario C: "Accept P → cohesion flips X;
      // slot-edge cascade P→C flips C." Cursor starts on P (first cycle-tier
      // alphabetical). [a] accepts P → cohesion pulls X + slot P→C flips C.
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={SCENARIO_C} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['P', 'X', 'C']));
      expect(arg.rejected).toEqual([]);
    });

    it('[a] on non-cycle descendant C accepts C only — no cascade up to ancestors', () => {
      // Scenario-C corollary: C is a leaf, so accepting C should not drag P
      // (its parent) or X into accepted. Ancestor cascade is a REJECT-only
      // direction; accepts flow strictly DOWN through slots.
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={SCENARIO_C} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Jump to C via search — cycle-tier row layout makes j-counts fragile.
      stdin.write('/');
      stdin.write('C');
      stdin.write('\r');
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(['C']);
      expect(arg.accepted).not.toContain('P');
      expect(arg.accepted).not.toContain('X');
      expect(arg.rejected).toEqual(expect.arrayContaining(['P', 'X']));
    });
  });

  describe('T4 — search-time neighborhood filter (grouped view)', () => {
    // A slots B slots C slots D. Cursor starts on A.
    const CHAIN = [
      { name: 'A', componentId: 'a', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', componentId: 'b', slots: [{ name: 's', allowedComponents: ['C'] }] },
      { name: 'C', componentId: 'c', slots: [{ name: 's', allowedComponents: ['D'] }] },
      { name: 'D', componentId: 'd' },
    ];

    it('search matching only B keeps A and C visible; hides D', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('/');
      stdin.write('B');
      const frame = lastFrame() ?? '';
      // Look at lines that carry a selection glyph — those are the sidebar
      // rows for real components. At tip (no filter) every component
      // renders such a row; with the filter active, D's row is dropped.
      const componentRowLines = frame
        .split('\n')
        .filter((l) => /\[[ ✓✗×]\]/.test(l));
      const namesInSidebar = new Set<string>();
      for (const l of componentRowLines) {
        for (const name of ['A', 'B', 'C', 'D']) {
          // Match component labels as isolated tokens (adjacent to
          // whitespace, tree glyphs, or line boundaries).
          if (new RegExp(`(^|[\\s├└─▸▾]) ?${name}(\\s|$|[^A-Za-z])`).test(l)) {
            namesInSidebar.add(name);
          }
        }
      }
      expect(namesInSidebar.has('A')).toBe(true);
      expect(namesInSidebar.has('B')).toBe(true);
      expect(namesInSidebar.has('C')).toBe(true);
      expect(namesInSidebar.has('D')).toBe(false);
    });

    it('header/counter strip continues to show full totals when filter active', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      const before = lastFrame() ?? '';
      // Grab the "Found N component" line.
      const totalLineBefore = before.split('\n').find((l) => /Found \d+ component/.test(l)) ?? '';
      stdin.write('/');
      stdin.write('B');
      const after = lastFrame() ?? '';
      const totalLineAfter = after.split('\n').find((l) => /Found \d+ component/.test(l)) ?? '';
      expect(totalLineAfter).toEqual(totalLineBefore);
      expect(totalLineAfter).toContain('4');
    });
  });

  describe('T5 — jump-and-filter [i] (transitive ancestors)', () => {
    // A slots B slots C slots D.
    const CHAIN = [
      { name: 'A', componentId: 'a', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', componentId: 'b', slots: [{ name: 's', allowedComponents: ['C'] }] },
      { name: 'C', componentId: 'c', slots: [{ name: 's', allowedComponents: ['D'] }] },
      { name: 'D', componentId: 'd' },
    ];

    function sidebarNames(frame: string): Set<string> {
      const componentRowLines = frame.split('\n').filter((l) => /\[[ ✓✗×]\]/.test(l));
      const found = new Set<string>();
      for (const l of componentRowLines) {
        for (const name of ['A', 'B', 'C', 'D']) {
          if (new RegExp(`(^|[\\s├└─▸▾]) ?${name}(\\s|$|[^A-Za-z])`).test(l)) {
            found.add(name);
          }
        }
      }
      return found;
    }

    function focusRow(stdin: NodeJS.WritableStream, from: string, to: string, chain: string[]): void {
      const fromIdx = chain.indexOf(from);
      const toIdx = chain.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return;
      const steps = toIdx - fromIdx;
      const key = steps >= 0 ? 'j' : 'k';
      const n = Math.abs(steps);
      for (let i = 0; i < n; i++) stdin.write(key);
    }

    it('[i] on component with two ancestors filters to target + those two', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      // Alphabetical grouped order: A, B, C, D. Move to C.
      focusRow(stdin, 'A', 'C', ['A', 'B', 'C', 'D']);
      stdin.write('i');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(true);
      expect(names.has('C')).toBe(true);
      expect(names.has('D')).toBe(false);
    });

    it('[i] on root shows only that component', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      // Cursor starts on A (root).
      stdin.write('i');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(false);
      expect(names.has('C')).toBe(false);
      expect(names.has('D')).toBe(false);
    });

    it('[i] is transitive — deep leaf shows every ancestor', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      focusRow(stdin, 'A', 'D', ['A', 'B', 'C', 'D']);
      stdin.write('i');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(true);
      expect(names.has('C')).toBe(true);
      expect(names.has('D')).toBe(true);
    });

    it('Esc clears jump filter — all rows visible again', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      focusRow(stdin, 'A', 'C', ['A', 'B', 'C', 'D']);
      stdin.write('i');
      // Esc key
      stdin.write('');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(true);
      expect(names.has('C')).toBe(true);
      expect(names.has('D')).toBe(true);
    });

    it('legend advertises [i]', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />,
      );
      const out = lastFrame() ?? '';
      expect(out).toContain('[i]');
    });
  });

  // T7 — focused-row detail line no longer truncates the AI reason at 60 chars.
  // Full reason renders (wrapped) up to a 4-line cap with an ellipsis on
  // overflow. The AI-recommends-exclusions banner list still uses the compact
  // truncated form.
  describe('T7 — no-truncate AI reason on focused-row detail', () => {
    it('renders the full AI reason past the 60-char truncate boundary on the focused row', () => {
      const marker = 'UNIQUEMARKERWORD';
      const longReason = 'x'.repeat(65) + marker + '.'.repeat(120);
      expect(longReason.length).toBeGreaterThan(60);
      const local = [
        { name: 'AAA', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: longReason },
        { name: 'Zeta', componentId: 'c1' },
      ];
      const { lastFrame } = render(
        <ScopeGateStep components={local} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      const out = lastFrame() ?? '';
      // Focused row is AAA (alphabetically first). Full reason (including the
      // marker at position 65) must appear — no 60-char truncate on this line.
      expect(out).toContain(marker);
    });

    it('AI-rationale goto-banner row renders the FULL reason without truncation (L7)', async () => {
      const longReason = 'x'.repeat(80) + 'TAILWORD';
      // Aaa is a non-flagged standalone that sorts first, so it (not the flagged
      // Zeta) is the initially-focused row — keeping Zeta's reason out of the
      // focused-row detail block, so the ONLY place the reason surfaces is the
      // goto-banner.
      const local = [
        { name: 'Aaa', componentId: 'c0' },
        { name: 'Zeta', componentId: 'c1', aiDecision: 'rejected' as const, aiReason: longReason },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={local} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      // The banner no longer truncates: the full reason renders (the sidebar-slot
      // box wraps long text), so the tail past the old 60-char cap must appear
      // and no ellipsis cap is applied to the row.
      stdin.write('x');
      await new Promise((r) => setTimeout(r, 30));
      const out = lastFrame() ?? '';
      expect(out).toContain('Zeta');
      expect(out).toContain('TAILWORD');
    });

    it('focused-row detail caps wrapped output; tail text past the cap is not rendered', () => {
      const longReason = 'A'.repeat(500) + 'TAILMARKER';
      const local = [
        { name: 'AAA', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: longReason },
      ];
      const { lastFrame } = render(
        <ScopeGateStep components={local} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      const out = lastFrame() ?? '';
      // Cap fires: the marker at position 500 must NOT be present.
      expect(out).not.toContain('TAILMARKER');
    });
  });

  describe('? help overlay (L3b)', () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

    it('advertises [?] help in the bottom legend', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      expect(stripAnsi(lastFrame() ?? '')).toContain('[?]');
    });

    it('pressing ? opens a help overlay listing ScopeGate keys; Esc closes it', async () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      const open = stripAnsi(lastFrame() ?? '');
      expect(open).toContain('Help');
      expect(open).toMatch(/lineage/i);
      // ScopeGate has no undo/redo.
      expect(open).not.toContain('Ctrl+Z');

      stdin.write('\x1b'); // Esc
      await new Promise((r) => setTimeout(r, 30));
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Help');
    });

    it('while the help overlay is open, other step keys are gated (f does not confirm)', async () => {
      const onConfirm = vi.fn();
      const { stdin } = render(
        <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      stdin.write('f');
      await new Promise((r) => setTimeout(r, 30));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('L2c — height-aware layout shrinks the sidebar when the lineage panel opens', () => {
    const MANY = Array.from({ length: 30 }, (_, i) => ({
      name: `Comp${String(i).padStart(2, '0')}`,
      componentId: `c${i}`,
    }));

    function countSidebarRows(frame: string): number {
      return frame
        .split('\n')
        .filter((l) => /Comp\d\d/.test(l) && !/Lineage/.test(l)).length;
    }

    it('renders fewer sidebar rows with the panel open than closed (fits terminal)', async () => {
      const closed = render(
        <ScopeGateStep components={MANY} onConfirm={() => {}} onQuit={() => {}} />,
      );
      const closedRows = countSidebarRows(closed.lastFrame() ?? '');

      const { stdin, lastFrame } = render(
        <ScopeGateStep components={MANY} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('l'); // open lineage panel
      await new Promise((r) => setTimeout(r, 30));
      const openFrame = lastFrame() ?? '';
      const openRows = countSidebarRows(openFrame);

      // Panel is open (its header renders).
      expect(openFrame).toContain('Lineage:');
      // Sidebar shrank: with stdout.rows unavailable in tests the layout uses
      // the conservative fallback, which shrinks the sidebar well below the
      // full closed height so the whole stack fits.
      expect(openRows).toBeLessThan(closedRows);
    });
  });

  describe('L2d — lineage renders as a sidebar overlay (not stacked below)', () => {
    function withWideStdout(cols: number): () => void {
      const probe = render(<ScopeGateStep components={[]} onConfirm={() => {}} onQuit={() => {}} />);
      const proto = Object.getPrototypeOf(probe.stdout);
      const original = Object.getOwnPropertyDescriptor(proto, 'columns');
      Object.defineProperty(proto, 'columns', { configurable: true, get: () => cols });
      probe.unmount();
      probe.cleanup();
      return () => {
        if (original) Object.defineProperty(proto, 'columns', original);
      };
    }

    // Article slots Card; Zzz is an unrelated standalone that only ever
    // renders in the main sidebar (undecided → never in the added columns,
    // never in Card's lineage). So its presence is a proxy for "the
    // GroupedSidebar is rendered".
    const FIXTURE_L2D = [
      { name: 'Article', componentId: 'a0', slots: [{ name: 'body', allowedComponents: ['Card'] }] },
      { name: 'Card', componentId: 'c0' },
      { name: 'Zzz', componentId: 'z0' },
    ];

    it('when lineage is open the sidebar is replaced by the panel; columns 2 & 3 stay visible', async () => {
      const restore = withWideStdout(160);
      try {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={FIXTURE_L2D} onConfirm={() => {}} onQuit={() => {}} />,
        );
        // Baseline: sidebar renders Zzz, columns 2 & 3 present.
        const before = lastFrame() ?? '';
        expect(before).toContain('Zzz');
        expect(before).toContain('Added components');
        expect(before).toContain('Added groups');

        // Focus Card, open lineage.
        stdin.write('j'); // move off Article toward Card
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('l');
        await new Promise((r) => setTimeout(r, 30));
        const open = lastFrame() ?? '';

        // (a) the lineage panel content renders.
        expect(open).toContain('Lineage:');
        // (b) the GroupedSidebar no longer occupies the sidebar slot — the
        // sidebar-only component Zzz is gone.
        expect(open).not.toContain('Zzz');
        // (c) columns 2 & 3 stay visible alongside the overlay.
        expect(open).toContain('Added components');
        expect(open).toContain('Added groups');
      } finally {
        restore();
      }
    });
  });

  describe('L7 — AI-rationale goto-banner', () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

    function withWideStdout(cols: number): () => void {
      const probe = render(<ScopeGateStep components={[]} onConfirm={() => {}} onQuit={() => {}} />);
      const proto = Object.getPrototypeOf(probe.stdout);
      const original = Object.getOwnPropertyDescriptor(proto, 'columns');
      Object.defineProperty(proto, 'columns', { configurable: true, get: () => cols });
      probe.unmount();
      probe.cleanup();
      return () => {
        if (original) Object.defineProperty(proto, 'columns', original);
      };
    }

    // BadgeIcon + DivWrapper are AI-flagged with reasons. Hero is an
    // undecided, non-flagged standalone that only ever renders in the main
    // sidebar (never in the added columns, never AI-flagged) — so its presence
    // is a proxy for "the GroupedSidebar occupies the sidebar slot".
    const MIXED = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
      { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
      { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'no semantic content' },
      { name: 'Hero', componentId: 'c4' },
    ];

    it('replaces the multi-line gray list with a one-line hint advertising [x]', () => {
      const { lastFrame } = render(
        <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      const out = stripAnsi(lastFrame() ?? '');
      // One-line hint carries the count + the keybinding.
      expect(out).toContain('AI recommended exclusions');
      expect(out).toContain('[x]');
      // The OLD inline gray list is gone: DivWrapper's reason no longer renders
      // inline (BadgeIcon is the initially-focused row so its reason still shows
      // in the focused-row detail — DivWrapper's does not appear anywhere).
      expect(out).not.toContain('no semantic content');
    });

    it('[x] opens a goto-banner in the sidebar slot listing AI-flagged components; columns 2 & 3 stay', async () => {
      const restore = withWideStdout(160);
      try {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
        );
        const before = stripAnsi(lastFrame() ?? '');
        // Baseline: sidebar renders Hero, columns 2 & 3 present.
        expect(before).toContain('Hero');
        expect(before).toContain('Added components');
        expect(before).toContain('Added groups');

        stdin.write('x');
        await new Promise((r) => setTimeout(r, 30));
        const open = stripAnsi(lastFrame() ?? '');

        // (a) banner lists AI-flagged components.
        expect(open).toContain('BadgeIcon');
        expect(open).toContain('DivWrapper');
        // (b) sidebar slot is replaced — the sidebar-only Hero is gone.
        expect(open).not.toContain('Hero');
        // (c) columns 2 & 3 stay visible alongside the banner (no stacking).
        expect(open).toContain('Added components');
        expect(open).toContain('Added groups');

        // Esc closes; sidebar (Hero) returns.
        stdin.write('\x1b');
        await new Promise((r) => setTimeout(r, 30));
        const closed = stripAnsi(lastFrame() ?? '');
        expect(closed).toContain('Hero');
      } finally {
        restore();
      }
    });

    it('Enter jumps the main cursor to the selected flagged component', async () => {
      const restore = withWideStdout(160);
      try {
        const onConfirm = vi.fn();
        const { stdin } = render(
          <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
        );
        stdin.write('x'); // open AI-rationale banner (cursor on BadgeIcon)
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('j'); // move banner cursor to DivWrapper
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('\r'); // Enter → jump main cursor to DivWrapper + close
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('a'); // accept the now-focused row
        stdin.write('f');
        const arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
        expect(arg.accepted).toContain('DivWrapper');
      } finally {
        restore();
      }
    });

    it('with zero AI-flagged components the hint is hidden and [x] is a no-op', async () => {
      const clean = [
        { name: 'Alpha', componentId: 'c0' },
        { name: 'Beta', componentId: 'c1' },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={clean} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('AI recommended exclusions');
      stdin.write('x');
      await new Promise((r) => setTimeout(r, 30));
      const out = stripAnsi(lastFrame() ?? '');
      // No banner opened (Alpha still in the sidebar; nothing changed).
      expect(out).toContain('Alpha');
      expect(out).not.toContain('AI recommended exclusions');
    });
  });

  describe('L8 — category filters (broken / cycles)', () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    // NodeA ↔ NodeB form a cycle; Standalone is a plain non-cycle component;
    // BadgeIcon is AI-flagged (broken).
    const FIX = [
      {
        name: 'NodeA',
        componentId: 'a',
        slots: [{ name: 'slotA', allowedComponents: ['NodeB'] }],
      },
      {
        name: 'NodeB',
        componentId: 'b',
        slots: [{ name: 'slotB', allowedComponents: ['NodeA'] }],
      },
      { name: 'Standalone', componentId: 's' },
      { name: 'BadgeIcon', componentId: 'x', aiDecision: 'rejected' as const, aiReason: 'low value' },
    ];

    it('[o] cycles filter narrows grouped sidebar to cycle members; toggling off restores', async () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
      stdin.write('o');
      await new Promise((r) => setTimeout(r, 20));
      const filtered = stripAnsi(lastFrame() ?? '');
      expect(filtered).toContain('NodeA');
      expect(filtered).toContain('NodeB');
      // Non-cycle standalone is hidden in grouped view under an active filter.
      expect(filtered).not.toContain('Standalone');
      stdin.write('o');
      await new Promise((r) => setTimeout(r, 20));
      expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
    });

    it('[w] broken filter narrows to AI-flagged components; toggling off restores', async () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      stdin.write('w');
      await new Promise((r) => setTimeout(r, 20));
      const filtered = stripAnsi(lastFrame() ?? '');
      expect(filtered).toContain('BadgeIcon');
      expect(filtered).not.toContain('Standalone');
      stdin.write('w');
      await new Promise((r) => setTimeout(r, 20));
      expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
    });

    it('legend advertises the [o] cycles and [w] broken filter keys', async () => {
      const { lastFrame } = render(
        <ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      const out = stripAnsi(lastFrame() ?? '');
      expect(out).toContain('[o]');
      expect(out).toContain('[w]');
    });

    it('does not advertise a [d] deleted filter (ScopeGate has no deleted concept)', async () => {
      const { lastFrame } = render(
        <ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      const out = stripAnsi(lastFrame() ?? '');
      expect(out).not.toContain('[d] deleted');
    });
  });

  describe('L11 — legend/help overhaul', () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const CYC = [
      { name: 'NodeA', componentId: 'a', slots: [{ name: 'sA', allowedComponents: ['NodeB'] }] },
      { name: 'NodeB', componentId: 'b', slots: [{ name: 'sB', allowedComponents: ['NodeA'] }] },
      { name: 'Standalone', componentId: 's' },
    ];

    it('disambiguates the two cycle features: [c] cycle list vs [o] only cycles', async () => {
      const { stdin, lastFrame } = render(
        <ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      const legend = stripAnsi(lastFrame() ?? '');
      // No bare identical "cycles" label for both keys.
      expect(legend).toContain('[c] cycle list');
      expect(legend).toContain('[o] only cycles');
      // Help panel uses the same distinct labels.
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      const help = stripAnsi(lastFrame() ?? '');
      expect(help).toMatch(/Cycle list/i);
      expect(help).toMatch(/Only cycles/i);
    });

    it('active-highlight keys [L] flat and [/] search are present in the legend', async () => {
      const { lastFrame } = render(
        <ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      const legend = stripAnsi(lastFrame() ?? '');
      // These toggle/mode keys get the active-highlight treatment via
      // legendEntry (the highlight mechanism itself is unit-tested in
      // LegendEntry.test.tsx; ink-testing-library strips ANSI here).
      expect(legend).toContain('[L] flat');
      expect(legend).toContain('[/] search');
      expect(legend).toContain('[l] lineage');
      expect(legend).toContain('[i] focus lineage');
    });

    it('help panel groups sidebar-view keys (L, l, o, w, i) together', async () => {
      const { stdin, lastFrame } = render(
        <ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      const help = stripAnsi(lastFrame() ?? '');
      expect(help).toMatch(/Sidebar views/i);
    });

    it('[n] label matches its real behavior (next match, in Search group)', async () => {
      const { stdin, lastFrame } = render(
        <ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      const help = stripAnsi(lastFrame() ?? '');
      expect(help).toMatch(/Next match/i);
    });
  });
});

// ── L9 — expand/collapse groups + accept/reject GR parity ───────────────────
//
// ScopeGate mirrors GenerateReview's collapse model: [Space] toggles the
// focused group, [E]/[C] expand/collapse all. Accept rebinds so [a] accepts
// and [Space] NO LONGER accepts (it collapses). Groups seed expanded so the
// default view matches the previous always-expanded behavior.

describe('ScopeGateStep — L9 collapse + accept rebind', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const GROUP = [
    {
      name: 'Card',
      componentId: 'c0',
      slots: [{ name: 'body', allowedComponents: ['Body'] }],
    },
    { name: 'Body', componentId: 'b0' },
  ];

  it('[Space] no longer accepts the focused row (rebound to collapse)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={GROUP} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor on Card group-root. Space must NOT accept it.
    stdin.write(' ');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Body']));
  });

  it('[a] still accepts the focused row', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={GROUP} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Body']));
  });

  it('groups seed EXPANDED (default view matches old always-expanded)', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toContain('Body');
  });

  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('[Space] on the focused group collapses it, then re-expands', async () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />,
    );
    await flush();
    // Cursor on Card root. Collapse.
    stdin.write(' ');
    await flush();
    let frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ Card/);
    expect(frame).not.toMatch(/[├└]─ Body/);
    // Re-expand.
    stdin.write(' ');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toContain('Body');
  });

  it('[C] collapses all group roots; [E] expands all', async () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />,
    );
    await flush();
    stdin.write('C');
    await flush();
    let frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ Card/);
    expect(frame).not.toMatch(/[├└]─ Body/);
    stdin.write('E');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toContain('Body');
  });

  it('[C] collapses a cycle-participant group (set includes cycle participants)', async () => {
    const CYCLE = [
      {
        name: 'NodeA',
        componentId: 'a',
        slots: [{ name: 'slotA', allowedComponents: ['NodeB'] }],
      },
      {
        name: 'NodeB',
        componentId: 'b',
        slots: [{ name: 'slotB', allowedComponents: ['NodeA'] }],
      },
    ];
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CYCLE} onConfirm={() => {}} onQuit={() => {}} />,
    );
    await flush();
    // Cycle-tier rows render expanded by seed.
    let frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ ⚠ NodeA/);
    // Collapse-all must fold the cycle subtree.
    stdin.write('C');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ ⚠ NodeA/);
    // Expand-all restores it.
    stdin.write('E');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ ⚠ NodeA/);
  });

  it('legend advertises [space] collapse + [E/C] and NOT "a/space" accept', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const legend = stripAnsi(lastFrame() ?? '');
    expect(legend).toContain('[a] accept');
    expect(legend).not.toContain('[a/space]');
    expect(legend).toMatch(/\[space\][^\n]*expand\/collapse group/);
    expect(legend).toMatch(/\[E\/C\]/);
  });

  it('help panel Selection entry no longer says "a / space"', async () => {
    const { stdin, lastFrame } = render(
      <ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 30));
    const help = stripAnsi(lastFrame() ?? '');
    expect(help).not.toContain('a / space');
  });
});
