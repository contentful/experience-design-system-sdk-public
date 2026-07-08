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

describe('ScopeGateStep — default inclusion (AI decisions honored)', () => {
  it('AI-rejected rows start EXCLUDED, AI-accepted/undecided rows start INCLUDED', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Button', 'Card']));
    expect(arg.rejected).toEqual(['DebugPanel']);
  });
});

describe('ScopeGateStep — toggle semantics', () => {
  it('Space/a toggles the focused standalone row INCLUDED ↔ EXCLUDED', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={onConfirm} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // With no slot data every row falls into the standalone tier. Cursor
    // starts on the first sidebar row. Toggle it, then partition on `f`.
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    // Whichever row was under the cursor flipped state. The exact row order
    // is alphabetical (standalones tier) — Button first, so Button is now
    // EXCLUDED.
    expect(arg.rejected).toContain('Button');
    expect(arg.accepted).not.toContain('Button');
  });

  it('focused-row detail line shows `included` / `excluded` state', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={MIXED} onConfirm={() => {}} onQuit={() => {}} aiFilterStatus="complete" />,
    );
    // Cursor starts on the first standalone (Button, alphabetical). Toggle it OFF.
    stdin.write('a');
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('excluded');
  });
});

describe('ScopeGateStep — manual decision wins over streaming AI', () => {
  it('operator-included AI-rejected row survives a later AI stream update', () => {
    const onConfirm = vi.fn();
    const initial = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const { rerender, stdin } = render(
      <ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Toggle Button OFF then ON so it lands in userUnExcluded.
    stdin.write('a'); // exclude Button
    stdin.write('a'); // re-include Button (now sticky-included)
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

  it('operator-excluded AI-accepted row stays EXCLUDED across re-renders', () => {
    const onConfirm = vi.fn();
    const initial = [
      { name: 'Button', componentId: 'c0', aiDecision: 'accepted' as const },
      { name: 'Card', componentId: 'c1' },
    ];
    const { rerender, stdin } = render(<ScopeGateStep components={initial} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('a'); // exclude Button
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
    const longReason = 'a'.repeat(120);
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
    expect(out).not.toContain('a'.repeat(120));
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
  it('legend advertises toggle, lineage, search, continue, quit, toggle-all', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={[{ name: 'Button', componentId: 'c0' }]} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('toggle');
    expect(out).toContain('all');
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
