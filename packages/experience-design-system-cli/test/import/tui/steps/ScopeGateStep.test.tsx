import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep, type ScopeComponent } from '../../../../src/import/tui/steps/ScopeGateStep.js';

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
    stdin.write('A');
    stdin.write('f');
    let arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
    expect(arg.rejected).toEqual([]);

    stdin.write('A');
    stdin.write('f');
    arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
  });

  it('[r] rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
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

  it('[Y] then [f] partitions AI-flagged (rejected/failed) into rejected, rest into accepted', () => {
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
      stdin.write('k');
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
      const { stdin } = render(<ScopeGateStep components={ARTICLE_CARD} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('A');
      stdin.write('j');
      stdin.write('r');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Article']));
      expect(arg.accepted).toEqual([]);
    });

    it('accepting a root cascades to descendants', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={ARTICLE_CARD} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['Article', 'Card']));
      expect(arg.rejected).toEqual([]);
    });

    it('reject cascade with blast-radius ≥ 2 shows confirm; [y] applies', () => {
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
      stdin.write('A');
      stdin.write('j');
      stdin.write('r');
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Rejecting Card will:');
      expect(frame).toContain('Article');
      expect(frame).toContain('Newsletter');
      stdin.write('y');
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
      const { stdin } = render(<ScopeGateStep components={TWO_PARENTS} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('A');
      stdin.write('j');
      stdin.write('r');
      stdin.write('n');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
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
      const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('A');
      stdin.write('j');
      stdin.write('r');
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
      const noCycles = [{ name: 'Solo', componentId: 's' }];
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
      const withStandalone = [...FIXTURE_2CYCLE, { name: 'Zonk', componentId: 'z' }];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={withStandalone} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      stdin.write('j');
      stdin.write('j');
      stdin.write('c');
      stdin.write('\r');
      expect(lastFrame() ?? '').not.toContain('Cycles detected');
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
      const { lastFrame } = render(<ScopeGateStep components={CYCLE_FIXTURE} onConfirm={() => {}} onQuit={() => {}} />);
      expect(lastFrame() ?? '').toContain('If you must have components with cycles');
    });

    it('does not render guidance banner when no cycles exist', () => {
      const noCycles = [{ name: 'Solo', componentId: 's' }];
      const { lastFrame } = render(<ScopeGateStep components={noCycles} onConfirm={() => {}} onQuit={() => {}} />);
      expect(lastFrame() ?? '').not.toContain('If you must have components with cycles');
    });
  });

  describe('cycle-row rejection (INTEG task #31)', () => {
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
      const { stdin } = render(<ScopeGateStep components={CYCLE} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('r');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.rejected).toEqual(expect.arrayContaining(['NodeA', 'NodeB']));
      expect(arg.accepted).toEqual([]);
    });

    it('Space on a cycle-tier row does NOT accept (L9 rebind: space = collapse)', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={CYCLE} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write(' ');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).not.toContain('NodeA');
    });

    it('[a] on a cycle-tier row after a reject re-accepts the whole cycle unit (task #47 cohesion)', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={CYCLE} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('r');
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['NodeA', 'NodeB']));
      expect(arg.rejected).toEqual([]);
    });

    it('cycle-row glyph still renders after a cycle participant is rejected', () => {
      const { lastFrame, stdin } = render(<ScopeGateStep components={CYCLE} onConfirm={() => {}} onQuit={() => {}} />);
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
      expect(frame).toContain('/b');
      expect(frame).toContain('2/3');
    });

    it('Esc while a query is active (and search input closed) clears the query', () => {
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={FIXTURE_S} onConfirm={() => {}} onQuit={() => {}} />,
      );
      stdin.write('/');
      stdin.write('b');
      stdin.write('\r');
      let frame = lastFrame() ?? '';
      expect(frame).toContain('/b');
      stdin.write('\x1b');
      frame = lastFrame() ?? '';
      expect(frame).not.toContain('/b');
    });

    describe('L4 — Tab autocomplete possibilities + [n] match-cycle', () => {
      const T3_FIXTURE = [
        { name: 'Widget', componentId: 'c0' },
        { name: 'Wizard', componentId: 'c1' },
        { name: 'Waffle', componentId: 'c2' },
      ];
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
        expect(frame).toContain('/Wid');
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
        stdin.write('i');
        const frame = lastFrame() ?? '';
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
        stdin.write('\r');
        const before = lastFrame() ?? '';
        stdin.write('\t');
        const after = lastFrame() ?? '';
        expect(after).toContain('/W');
        void before;
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
      expect(lastFrame() ?? '').not.toContain('AI recommended exclusions');

      const updated = [
        { name: 'Button', componentId: 'c0' },
        { name: 'Card', componentId: 'c1' },
        { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
      ];
      rerender(<ScopeGateStep components={updated} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('AI recommended exclusions');
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
      stdin.write('A');
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
    stdin.write('A');
    stdin.write('r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rejecting Card will:');
    expect(frame).toContain('Deselect descendants:');
    expect(frame).toContain('Text');
    expect(frame).toContain('Icon');
    stdin.write('y');
    const after = lastFrame() ?? '';
    expect(after).toContain('[✗]');
    expect(after).toContain('[ ]');
  });

  it('rejecting an accepted leaf rejects target + ancestors, leaves siblings accepted', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={ROOT_WITH_TWO_CHILDREN} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('A');
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Icon', 'Card']));
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
    const { stdin, lastFrame } = render(<ScopeGateStep components={MIDDLE} onConfirm={() => {}} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('j');
    stdin.write('r');
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
    stdin.write('A');
    stdin.write('r');
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
    stdin.write('A');
    stdin.write('r');
    stdin.write('y');
    stdin.write('j');
    stdin.write('a');
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
    stdin.write(' ');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).not.toContain('Card');
  });
});

describe('ScopeGateStep — cycle-unit cohesion (task #47)', () => {
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
    const { stdin } = render(<ScopeGateStep components={TWO_CYCLE} onConfirm={onConfirm} onQuit={() => {}} />);
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('/');
    stdin.write('W');
    stdin.write('r');
    stdin.write('\r');
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper', 'NodeA', 'NodeB']));
  });

  it('[a] on an ancestor with a cycle two levels down accepts all of them', () => {
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('Y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper', 'SharedInterior', 'InnerA', 'InnerB']));
  });

  it('[r] on a cycle member rejects every member + ancestors that reference any member', () => {
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
    const { stdin, lastFrame } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rejecting NodeA will:');
    stdin.write('y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['NodeA', 'NodeB', 'Wrapper1', 'Wrapper2']));
    expect(arg.accepted).toEqual([]);
  });

  it('[r] on a non-cycle ancestor of a cycle: ancestor rejected, cycle members deselect, non-cycle descendants deselect', () => {
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('/');
    stdin.write('W');
    stdin.write('\r');
    stdin.write('r');
    stdin.write('y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Wrapper', 'NodeA', 'NodeB', 'Leaf']));
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper', 'Standalone', 'NodeA', 'NodeB']));
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
    const setup: ScopeComponent[] = [
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('r');
    stdin.write('y');
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
    for (const c of setup) {
      if (!accepted.has(c.name)) continue;
      for (const slot of c.slots ?? []) {
        for (const target of slot.allowedComponents) {
          expect(accepted.has(target)).toBe(true);
        }
      }
    }
    expect(arg.accepted).toEqual(expect.arrayContaining(['Wrapper1', 'NodeA', 'NodeB']));
  });

  it('[a] on a cycle member with two overlapping cycles pulls both units together', () => {
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
    const { stdin } = render(<ScopeGateStep components={setup} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(arg.rejected).toEqual([]);
  });
});

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
      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={SCENARIO_A} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      expect(lastFrame() ?? '').toContain('nothing selected');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual([]);
      expect(arg.rejected).toEqual(expect.arrayContaining(['P', 'C']));
    });

    it('[a] on either cycle member accepts BOTH via cycle-unit cohesion', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={SCENARIO_A} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['P', 'C']));
      expect(arg.rejected).toEqual([]);
    });

    it('[r] on either cycle member rejects BOTH via cycle-unit cohesion', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={SCENARIO_A} onConfirm={onConfirm} onQuit={() => {}} />);
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
      expect(frame).toContain('[c]');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual([]);
    });

    it('accepting P via [Y] cascades DOWN P→C and cohesion pulls X in', () => {
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
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={SCENARIO_B} onConfirm={onConfirm} onQuit={() => {}} />);
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
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={SCENARIO_C} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('a');
      stdin.write('f');
      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['P', 'X', 'C']));
      expect(arg.rejected).toEqual([]);
    });

    it('[a] on non-cycle descendant C accepts C only — no cascade up to ancestors', () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={SCENARIO_C} onConfirm={onConfirm} onQuit={() => {}} />);
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
    const CHAIN = [
      { name: 'A', componentId: 'a', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', componentId: 'b', slots: [{ name: 's', allowedComponents: ['C'] }] },
      { name: 'C', componentId: 'c', slots: [{ name: 's', allowedComponents: ['D'] }] },
      { name: 'D', componentId: 'd' },
    ];

    it('search matching only B keeps A and C visible; hides D', () => {
      const { lastFrame, stdin } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      stdin.write('/');
      stdin.write('B');
      const frame = lastFrame() ?? '';
      const componentRowLines = frame.split('\n').filter((l) => /\[[ ✓✗×]\]/.test(l));
      const namesInSidebar = new Set<string>();
      for (const l of componentRowLines) {
        for (const name of ['A', 'B', 'C', 'D']) {
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
      const { lastFrame, stdin } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      const before = lastFrame() ?? '';
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

    function focusRow(stdin: { write: (data: string) => void }, from: string, to: string, chain: string[]): void {
      const fromIdx = chain.indexOf(from);
      const toIdx = chain.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return;
      const steps = toIdx - fromIdx;
      const key = steps >= 0 ? 'j' : 'k';
      const n = Math.abs(steps);
      for (let i = 0; i < n; i++) stdin.write(key);
    }

    it('[i] on component with two ancestors filters to target + those two', () => {
      const { lastFrame, stdin } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      focusRow(stdin, 'A', 'C', ['A', 'B', 'C', 'D']);
      stdin.write('i');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(true);
      expect(names.has('C')).toBe(true);
      expect(names.has('D')).toBe(false);
    });

    it('[i] on root shows only that component', () => {
      const { lastFrame, stdin } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      stdin.write('i');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(false);
      expect(names.has('C')).toBe(false);
      expect(names.has('D')).toBe(false);
    });

    it('[i] is transitive — deep leaf shows every ancestor', () => {
      const { lastFrame, stdin } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      focusRow(stdin, 'A', 'D', ['A', 'B', 'C', 'D']);
      stdin.write('i');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(true);
      expect(names.has('C')).toBe(true);
      expect(names.has('D')).toBe(true);
    });

    it('Esc clears jump filter — all rows visible again', () => {
      const { lastFrame, stdin } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      focusRow(stdin, 'A', 'C', ['A', 'B', 'C', 'D']);
      stdin.write('i');
      stdin.write('');
      const names = sidebarNames(lastFrame() ?? '');
      expect(names.has('A')).toBe(true);
      expect(names.has('B')).toBe(true);
      expect(names.has('C')).toBe(true);
      expect(names.has('D')).toBe(true);
    });

    it('legend advertises [i]', () => {
      const { lastFrame } = render(<ScopeGateStep components={CHAIN} onConfirm={() => {}} onQuit={() => {}} />);
      const out = lastFrame() ?? '';
      expect(out).toContain('[i]');
    });
  });

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
      expect(out).toContain(marker);
    });

    it('AI-rationale goto-banner row renders the FULL reason without truncation (L7)', async () => {
      const longReason = 'x'.repeat(80) + 'TAILWORD';
      const local = [
        { name: 'Aaa', componentId: 'c0' },
        { name: 'Zeta', componentId: 'c1', aiDecision: 'rejected' as const, aiReason: longReason },
      ];
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={local} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      stdin.write('x');
      await new Promise((r) => setTimeout(r, 30));
      const out = lastFrame() ?? '';
      expect(out).toContain('Zeta');
      expect(out).toContain('TAILWORD');
    });

    it('focused-row detail caps wrapped output; tail text past the cap is not rendered', () => {
      const longReason = 'A'.repeat(500) + 'TAILMARKER';
      const local = [{ name: 'AAA', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: longReason }];
      const { lastFrame } = render(
        <ScopeGateStep components={local} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
      );
      const out = lastFrame() ?? '';
      expect(out).not.toContain('TAILMARKER');
    });
  });

  describe('? help overlay (L3b)', () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

    it('advertises [?] help in the bottom legend', () => {
      const { lastFrame } = render(<ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={() => {}} />);
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
      expect(open).not.toContain('Ctrl+Z');

      stdin.write('\x1b');
      await new Promise((r) => setTimeout(r, 30));
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Help');
    });

    it('while the help overlay is open, other step keys are gated (f does not confirm)', async () => {
      const onConfirm = vi.fn();
      const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
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
      return frame.split('\n').filter((l) => /Comp\d\d/.test(l) && !/Lineage/.test(l)).length;
    }

    it('renders fewer sidebar rows with the panel open than closed (fits terminal)', async () => {
      const closed = render(<ScopeGateStep components={MANY} onConfirm={() => {}} onQuit={() => {}} />);
      const closedRows = countSidebarRows(closed.lastFrame() ?? '');

      const { stdin, lastFrame } = render(<ScopeGateStep components={MANY} onConfirm={() => {}} onQuit={() => {}} />);
      stdin.write('l');
      await new Promise((r) => setTimeout(r, 30));
      const openFrame = lastFrame() ?? '';
      const openRows = countSidebarRows(openFrame);

      expect(openFrame).toContain('Lineage:');
      expect(openRows).toBeLessThan(closedRows);
    });
  });

  describe('L2e — sidebar autoscales to a small terminal height', () => {
    const MANY = Array.from({ length: 30 }, (_, i) => ({
      name: `Comp${String(i).padStart(2, '0')}`,
      componentId: `c${i}`,
    }));

    function countSidebarRows(frame: string): number {
      return frame.split('\n').filter((l) => /Comp\d\d/.test(l) && !/Lineage/.test(l)).length;
    }

    function withRows(rows: number): () => void {
      const probe = render(<ScopeGateStep components={[]} onConfirm={() => {}} onQuit={() => {}} />);
      const proto = Object.getPrototypeOf(probe.stdout);
      const original = Object.getOwnPropertyDescriptor(proto, 'rows');
      Object.defineProperty(proto, 'rows', { configurable: true, get: () => rows });
      probe.unmount();
      probe.cleanup();
      return () => {
        if (original) Object.defineProperty(proto, 'rows', original);
        else delete (proto as Record<string, unknown>).rows;
      };
    }

    it('renders FEWER sidebar rows on a short terminal than on a tall one', () => {
      const restoreTall = withRows(60);
      const tall = render(<ScopeGateStep components={MANY} onConfirm={() => {}} onQuit={() => {}} />);
      const tallRows = countSidebarRows(tall.lastFrame() ?? '');
      tall.unmount();
      tall.cleanup();
      restoreTall();

      const restoreShort = withRows(24);
      const short = render(<ScopeGateStep components={MANY} onConfirm={() => {}} onQuit={() => {}} />);
      const shortRows = countSidebarRows(short.lastFrame() ?? '');
      short.unmount();
      short.cleanup();
      restoreShort();

      expect(shortRows).toBeLessThan(tallRows);
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
        const before = lastFrame() ?? '';
        expect(before).toContain('Zzz');
        expect(before).toContain('Added components');
        expect(before).toContain('Added groups');

        stdin.write('j');
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('l');
        await new Promise((r) => setTimeout(r, 30));
        const open = lastFrame() ?? '';

        expect(open).not.toContain('Zzz');
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
      expect(out).toContain('AI recommended exclusions');
      expect(out).toContain('[x]');
      expect(out).not.toContain('no semantic content');
    });

    it('[x] opens a goto-banner in the sidebar slot listing AI-flagged components; columns 2 & 3 stay', async () => {
      const restore = withWideStdout(160);
      try {
        const { lastFrame, stdin } = render(
          <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
        );
        const before = stripAnsi(lastFrame() ?? '');
        expect(before).toContain('Hero');
        expect(before).toContain('Added components');
        expect(before).toContain('Added groups');

        stdin.write('x');
        await new Promise((r) => setTimeout(r, 30));
        const open = stripAnsi(lastFrame() ?? '');

        expect(open).toContain('BadgeIcon');
        expect(open).toContain('DivWrapper');
        expect(open).not.toContain('Hero');
        expect(open).toContain('Added components');
        expect(open).toContain('Added groups');

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
        stdin.write('x');
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('j');
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('a');
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
      expect(out).toContain('Alpha');
      expect(out).not.toContain('AI recommended exclusions');
    });
  });

  describe('L8 — category filters (cycles)', () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
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
      const { lastFrame, stdin } = render(<ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
      stdin.write('o');
      await new Promise((r) => setTimeout(r, 20));
      const filtered = stripAnsi(lastFrame() ?? '');
      expect(filtered).toContain('NodeA');
      expect(filtered).toContain('NodeB');
      expect(filtered).not.toContain('Standalone');
      stdin.write('o');
      await new Promise((r) => setTimeout(r, 20));
      expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
    });

    it('legend advertises [o] only cycles when cycles exist; does not show [w]', async () => {
      const { lastFrame } = render(<ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />);
      await new Promise((r) => setTimeout(r, 20));
      const out = stripAnsi(lastFrame() ?? '');
      expect(out).not.toContain('[w]');
      expect(out).toContain('[o]');
      expect(out).toContain('only cycles');
    });

    it('does not advertise a [d] deleted filter (ScopeGate has no deleted concept)', async () => {
      const { lastFrame } = render(<ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />);
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

    it('shows [c] cycle list and [o] only cycles in legend when cycles exist; no [w]', async () => {
      const { stdin, lastFrame } = render(<ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />);
      await new Promise((r) => setTimeout(r, 20));
      const legend = stripAnsi(lastFrame() ?? '');
      expect(legend).toContain('[c] cycle list');
      expect(legend).toContain('[o] only cycles');
      expect(legend).not.toContain('[w]');
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      const help = stripAnsi(lastFrame() ?? '');
      expect(help).toMatch(/Cycle list/i);
      expect(help).toMatch(/Only cycles/i);
    });

    it('active-highlight keys [L] flat and [/] search are present in the legend', async () => {
      const { lastFrame } = render(<ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />);
      await new Promise((r) => setTimeout(r, 20));
      const legend = stripAnsi(lastFrame() ?? '');
      expect(legend).toContain('[L] flat');
      expect(legend).toContain('[/] search');
      expect(legend).toContain('[l] lineage');
      expect(legend).toContain('[i] focus lineage');
    });

    it('help panel groups sidebar-view keys (L, l, o, w, i) together', async () => {
      const { stdin, lastFrame } = render(<ScopeGateStep components={CYC} onConfirm={() => {}} onQuit={() => {}} />);
      await new Promise((r) => setTimeout(r, 20));
      stdin.write('?');
      await new Promise((r) => setTimeout(r, 30));
      const help = stripAnsi(lastFrame() ?? '');
      expect(help).toMatch(/Sidebar views/i);
    });
  });
});

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
    const { stdin } = render(<ScopeGateStep components={GROUP} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write(' ');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Body']));
  });

  it('[a] still accepts the focused row', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={GROUP} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Body']));
  });

  it('groups seed EXPANDED (default view matches old always-expanded)', () => {
    const { lastFrame } = render(<ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toContain('Body');
  });

  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('[Space] on the focused group collapses it, then re-expands', async () => {
    const { lastFrame, stdin } = render(<ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />);
    await flush();
    stdin.write(' ');
    await flush();
    let frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ Card/);
    expect(frame).not.toMatch(/[├└]─ Body/);
    stdin.write(' ');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toContain('Body');
  });

  it('[C] collapses all group roots; [E] expands all', async () => {
    const { lastFrame, stdin } = render(<ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />);
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
    const { lastFrame, stdin } = render(<ScopeGateStep components={CYCLE} onConfirm={() => {}} onQuit={() => {}} />);
    await flush();
    let frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ ⚠ NodeA/);
    stdin.write('C');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ ⚠ NodeA/);
    stdin.write('E');
    await flush();
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▾ ⚠ NodeA/);
  });

  it('legend advertises [space] collapse + [E/C] and NOT "a/space" accept', () => {
    const { lastFrame } = render(<ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />);
    const legend = stripAnsi(lastFrame() ?? '');
    expect(legend).toContain('[a] accept');
    expect(legend).not.toContain('[a/space]');
    expect(legend).toMatch(/\[space\][^\n]*expand\/collapse group/);
    expect(legend).toMatch(/\[E\/C\]/);
  });

  it('help panel Selection entry no longer says "a / space"', async () => {
    const { stdin, lastFrame } = render(<ScopeGateStep components={GROUP} onConfirm={() => {}} onQuit={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 30));
    const help = stripAnsi(lastFrame() ?? '');
    expect(help).not.toContain('a / space');
  });
});

describe('FB2 — cursor + selection coherence under active category filters', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const cursorRowLabel = (frame: string): string | undefined => {
    const line = stripAnsi(frame)
      .split('\n')
      .find((l) => l.includes('▶'));
    if (!line) return undefined;
    return line
      .replace(/[▶✓✗×⚠▸▾├└─│\[\] ]/g, ' ')
      .replace(/\(cycle\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Zbrk1 ↔ Zbrk2 form a cycle so [o] (only cycles) actually fires.
  const FIX = [
    { name: 'Aaa', componentId: 'a' },
    { name: 'Bbb', componentId: 'b' },
    { name: 'Ccc', componentId: 'c' },
    { name: 'Ddd', componentId: 'd' },
    { name: 'Zbrk1', componentId: 'z1', slots: [{ name: 's', allowedComponents: ['Zbrk2'] }] },
    { name: 'Zbrk2', componentId: 'z2', slots: [{ name: 's', allowedComponents: ['Zbrk1'] }] },
  ];

  it('after [o] shrinks the list, cursor lands on a cycle member and navigation is not stuck', async () => {
    const { lastFrame, stdin } = render(<ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('o');
    await new Promise((r) => setTimeout(r, 20));
    const labelAfterFilter = cursorRowLabel(lastFrame() ?? '');
    // Cursor must be on a cycle member (not stuck on a stale out-of-range index).
    expect(['Zbrk1', 'Zbrk2']).toContain(labelAfterFilter);
    // Navigation is not frozen: pressing [k] moves back toward the start.
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('k');
    await new Promise((r) => setTimeout(r, 20));
    const after = cursorRowLabel(lastFrame() ?? '');
    expect(['Zbrk1', 'Zbrk2']).toContain(after);
  });

  it('accept targets the row the cursor moved to after a filter shrink', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIX} onConfirm={onConfirm} onQuit={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('o');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('k');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[onConfirm.mock.calls.length - 1][0];
    // Accepting a cycle member cascades to its partner (cycle-unit cohesion).
    expect(arg.accepted).toContain('Zbrk1');
    expect(arg.accepted).toContain('Zbrk2');
  });

  it('toggling [o] off then on again keeps navigation working (not stuck)', async () => {
    const { lastFrame, stdin } = render(<ScopeGateStep components={FIX} onConfirm={() => {}} onQuit={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    stdin.write('o');
    stdin.write('o');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('o');
    await new Promise((r) => setTimeout(r, 20));
    const labelAfterReactivate = cursorRowLabel(lastFrame() ?? '');
    // Cursor must be on a cycle member after re-activating the filter.
    expect(['Zbrk1', 'Zbrk2']).toContain(labelAfterReactivate);
  });
});
