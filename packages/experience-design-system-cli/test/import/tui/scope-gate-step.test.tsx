import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

// Grouped-sidebar wiring: the flat two-section render (AI-recommended-
// exclusions on top, Components below) was retired in favor of GroupedSidebar
// so composite closures are visible at selection time. The AI-decision signal
// is preserved via:
//   - a dim `AI recommended exclusions: N` summary line above the sidebar
//   - a `*` marker + full reason on the focused-row detail below the sidebar
//   - the `[s]` reason side-panel (untouched)
//
// The sticky-inclusion invariant (operator decisions win over streaming AI
// updates) is preserved, along with `f` confirm partition, `q` quit, `A`
// toggle-all, and `s` AI-reason panel.

const MIXED = [
  { name: 'Button', componentId: 'c0' },
  { name: 'DebugPanel', componentId: 'c1', aiDecision: 'rejected' as const, aiReason: 'internal-only widget' },
  { name: 'Card', componentId: 'c2' },
];

describe('ScopeGateStep — rendering', () => {
  it('renders every component in the sidebar (no silent drops)', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('DebugPanel');
    expect(out).toContain('Card');
  });

  it('surfaces an AI-recommended-exclusions summary when any component is AI-flagged', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI recommended exclusions');
    expect(out).toContain('1');
  });

  it('omits the AI-summary line when nothing is AI-flagged', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'Card', componentId: 'c1' },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('AI recommended exclusions');
    expect(out).not.toContain('[AI]');
  });
});

describe('ScopeGateStep — default inclusion (everything undecided)', () => {
  it('every row starts undecided; f without any interaction partitions everything into rejected', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual([]);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Button', 'Card', 'DebugPanel']));
  });

  it('[Y] accepts only non-AI-flagged rows; AI-rejects stay undecided → rejected on [f]', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('Y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.rejected).toEqual(['DebugPanel']);
  });
});

describe('ScopeGateStep — accept semantics', () => {
  it('[a] on the focused row marks it INCLUDED; [f] partitions accordingly', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Standalone tier alphabetical: BadgeDebug... Actually MIXED sorts as
    // Button, Card, DebugPanel. Cursor on Button → accept it.
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('Button');
    expect(arg.rejected).not.toContain('Button');
  });

  it('focused-row detail line shows `included` after [a]', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Cursor on Button (alphabetical). Accept it → detail line reads "included".
    stdin.write('a');
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('included');
  });
});

describe('ScopeGateStep — manual decision wins over streaming AI', () => {
  it('operator-accepted row survives a later AI stream update that flags it rejected', () => {
    const onConfirm = vi.fn();
    const initial = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const { rerender, stdin } = render(
      <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Explicitly accept Button.
    stdin.write('a');
    const streamed = [
      { name: 'Button', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: 'AI thinks no' },
      { name: 'Card', componentId: 'c1' },
    ];
    rerender(<ScopeGateStep components={streamed} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />);
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('Button');
    expect(arg.rejected).not.toContain('Button');
  });

  it('operator-rejected AI-accepted row stays REJECTED across re-renders', () => {
    const onConfirm = vi.fn();
    const initial = [
      { name: 'Button', componentId: 'c0', aiDecision: 'accepted' as const },
      { name: 'Card', componentId: 'c1' },
    ];
    const { rerender, stdin } = render(<ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('r'); // explicitly reject Button
    rerender(<ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />);
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toContain('Button');
  });
});

describe('ScopeGateStep — AI reason surfacing on focused row', () => {
  it('renders the AI reason as focused-row detail on an AI-flagged row', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'DebugPanel', componentId: 'c1', aiDecision: 'rejected', aiReason: 'internal-only widget' },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    // Cursor starts on the first standalone row (Button, alphabetical). Move
    // down to DebugPanel so its AI-reason detail renders.
    stdin.write('j');
    const out = lastFrame() ?? '';
    expect(out).toContain('DebugPanel');
    expect(out).toContain('internal-only widget');
  });

  it('truncates a long AI reason on the focused-row detail line', () => {
    // The focused-row detail caps at width * FOCUSED_REASON_MAX_LINES chars, so
    // the reason must exceed that budget to trigger the ellipsis. (L7 removed
    // the old inline gray list, which was the previous source of the ellipsis
    // on short reasons.)
    const longReason = 'a'.repeat(600) + 'TAILMARKER';
    const { lastFrame, stdin } = render(
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
    stdin.write('j');
    const out = lastFrame() ?? '';
    expect(out).toContain('…');
    expect(out).not.toContain('TAILMARKER');
  });

  it('opens the full-reason side panel on `s` when focused row is AI-flagged', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'DebugPanel', componentId: 'c1', aiDecision: 'rejected', aiReason: 'the full unlimited reason text' },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    stdin.write('j'); // focus DebugPanel
    stdin.write('s'); // open reason panel
    const out = lastFrame() ?? '';
    expect(out).toContain('AI rejection reason: DebugPanel');
    expect(out).toContain('the full unlimited reason text');
  });
});

describe('ScopeGateStep — legend', () => {
  it('legend advertises accept, reject, lineage, search, continue, quit, toggle-all, accept-non-flagged', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={[{ name: 'Button', componentId: 'c0' }]} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('accept');
    expect(out).toContain('reject');
    expect(out).toContain('toggle all');
    expect(out).toContain('accept non-flagged');
    expect(out).toContain('continue');
    expect(out).toContain('quit');
    expect(out).toContain('lineage');
    expect(out).toContain('search');
  });

  it('shows [s] AI reason only when at least one AI-flagged row exists', () => {
    const { lastFrame: framePlain } = render(
      <ScopeGateStep components={[{ name: 'Button', componentId: 'c0' }]} onConfirm={() => {}} onQuit={() => {}} />,
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
    expect(aiOut).toContain('[s]');
    expect(aiOut).toContain('reason');
  });
});
