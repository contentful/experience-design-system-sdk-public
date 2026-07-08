import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

// Composite-components grouping — scope-gate wiring tests.
//
// When ScopeGateStep receives components with `slots` metadata, it renders
// through GroupedSidebar so composite grouping (root + deps) is visible at
// selection time — matching the same tiering used in GenerateReviewStep.
//
// Selection semantics at scope-gate (post-D2 cascade rework):
//   - Groups render always-expanded (▾) — no collapse.
//   - Accepting any row cascades to all descendants.
//   - Rejecting any row cascades to all ancestors that slot it.
//   - Every row is individually selectable (roots, children, standalones, flat).

const withSlots = (
  name: string,
  componentId: string,
  slots: Array<{ name: string; allowedComponents: string[] }> = [],
) => ({
  name,
  componentId,
  slots,
});

describe('ScopeGateStep — grouped sidebar rendering', () => {
  it('renders a root as `▾ Root (N deps)` (always expanded) when it has children in its closure', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          withSlots('Card', 'c0', [{ name: 'body', allowedComponents: ['Text', 'Icon'] }]),
          withSlots('Text', 'c1'),
          withSlots('Icon', 'c2'),
          withSlots('Standalone', 'c3'),
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/▾ Card \(2 deps\)/);
    // Standalone stays flat (no arrow, no dep count).
    expect(out).toContain('Standalone');
    expect(out).not.toMatch(/[▸▾] Standalone/);
    // Children visible under the always-expanded root.
    expect(out).toContain('Text');
    expect(out).toContain('Icon');
  });
});

describe('ScopeGateStep — cycle-member injection under composite parents', () => {
  // Scenario 9 fixture from the react-ux-matrix debug harness:
  //   InnerA ↔ InnerB (slot each other → cycle),
  //   SharedInterior slots InnerA,
  //   Wrapper1 + Wrapper2 slot SharedInterior.
  // Before the fix: expanding Wrapper1/Wrapper2/SharedInterior never surfaced
  // InnerA/InnerB. After: InnerA appears as `⚠ InnerA (cycle)` under
  // SharedInterior AND (transitively) under Wrapper1 + Wrapper2.
  it('shows cycle members under every composite that slots them (scenario 9)', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          withSlots('InnerA', 'c0', [{ name: 's', allowedComponents: ['InnerB'] }]),
          withSlots('InnerB', 'c1', [{ name: 's', allowedComponents: ['InnerA'] }]),
          withSlots('SharedInterior', 'c2', [{ name: 's', allowedComponents: ['InnerA'] }]),
          withSlots('Wrapper1', 'c3', [{ name: 's', allowedComponents: ['SharedInterior'] }]),
          withSlots('Wrapper2', 'c4', [{ name: 's', allowedComponents: ['SharedInterior'] }]),
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    // Cycle tier at top: both InnerA and InnerB.
    expect(out).toContain('InnerA');
    expect(out).toContain('InnerB');
    // Wrapper roots present with dep counts.
    expect(out).toMatch(/Wrapper1/);
    expect(out).toMatch(/Wrapper2/);
    // InnerA appears MULTIPLE times: cycle-tier row plus injected cycle-child
    // rows under SharedInterior / Wrapper1 / Wrapper2 subtrees. Before the
    // fix, InnerA appeared exactly once (cycle-tier only).
    const innerAMatches = out.match(/InnerA/g) ?? [];
    expect(innerAMatches.length).toBeGreaterThan(1);
    // The (cycle) suffix decorates injected cycle-child rows.
    expect(out).toMatch(/⚠ InnerA \(cycle\)/);
  });
});

describe('ScopeGateStep — closure-aware selection', () => {
  it('Accepting a root cascades to every component in its closure', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={[
          withSlots('Card', 'c0', [{ name: 'body', allowedComponents: ['Text', 'Icon'] }]),
          withSlots('Text', 'c1'),
          withSlots('Icon', 'c2'),
          withSlots('Standalone', 'c3'),
        ]}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    // Cursor starts on the first row (Card root). Rejecting Card now
    // deselects its 2 descendants → blast radius 2 → confirm prompt. Press
    // [y] to apply. Then Space again re-accepts, cascading to Text + Icon.
    stdin.write(' '); // reject Card → confirm prompt (0 ancestors + 2 descendants)
    stdin.write('y'); // confirm: Card rejected, Text/Icon undecided
    stdin.write(' '); // accept Card → cascades to Text + Icon
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Text', 'Icon', 'Standalone']));
    expect(arg.rejected).not.toContain('Card');
    expect(arg.rejected).not.toContain('Text');
    expect(arg.rejected).not.toContain('Icon');
  });

  it('Rejecting a root deselects its descendants (undecided → partitions to rejected)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={[
          withSlots('Card', 'c0', [{ name: 'body', allowedComponents: ['Text', 'Icon'] }]),
          withSlots('Text', 'c1'),
          withSlots('Icon', 'c2'),
          withSlots('Standalone', 'c3'),
        ]}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    // Rejecting Card cascades UP (to its ancestors — none) and now DEselects
    // its descendants (Text, Icon → undecided). Blast radius = 2 → confirm.
    stdin.write(' ');
    stdin.write('y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    // Card explicitly rejected; Text/Icon undecided → partition to rejected.
    expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Text', 'Icon']));
    expect(arg.accepted).toEqual(['Standalone']);
  });

  it('Space on a standalone toggles only that component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={[
          withSlots('Card', 'c0', [{ name: 'body', allowedComponents: ['Text'] }]),
          withSlots('Text', 'c1'),
          withSlots('Standalone', 'c2'),
        ]}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    // Rows: Card (root), Text (child), Standalone. Move to Standalone (row 2).
    stdin.write('j'); // Text child
    stdin.write('j'); // Standalone
    stdin.write(' ');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(['Standalone']);
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Text']));
    expect(arg.accepted).not.toContain('Standalone');
  });

  it('Rejecting a group-child cascades to ancestors (blast radius 1 = no prompt)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={[
          withSlots('Card', 'c0', [{ name: 'body', allowedComponents: ['Text'] }]),
          withSlots('Text', 'c1'),
        ]}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    // Rows: Card (root), Text (child), flat-header, Card (flat), Text (flat).
    stdin.write('j'); // move to Text child
    stdin.write(' '); // reject Text — cascades to Card (blast radius 1 → no prompt).
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Text', 'Card']));
    expect(arg.accepted).toEqual([]);
  });
});
