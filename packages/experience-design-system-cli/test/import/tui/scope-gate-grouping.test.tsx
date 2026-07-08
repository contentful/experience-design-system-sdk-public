import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

// Composite-components grouping — scope-gate wiring tests.
//
// When ScopeGateStep receives components with `slots` metadata, it renders
// through GroupedSidebar so composite grouping (root + deps) is visible at
// selection time — matching the same tiering used in GenerateReviewStep.
//
// Selection semantics at scope-gate differ from generate-review:
//   - Space/a/r on a grouped-root row toggles the ENTIRE closure's inclusion.
//   - Space on a group-child row (inside a grouped-roots tier) is a no-op.
//   - Space on a standalone row toggles just that component.

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
  it('renders a root as `▸ Root (N deps)` when it has children in its closure', () => {
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
    expect(out).toMatch(/▸ Card \(2 deps\)/);
    // Standalone stays flat (no arrow, no dep count).
    expect(out).toContain('Standalone');
    expect(out).not.toMatch(/▸ Standalone/);
  });

  it('expands a group on Enter (Root becomes `▾ Root (N deps)` with children)', () => {
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={[
          withSlots('Card', 'c0', [{ name: 'body', allowedComponents: ['Text', 'Icon'] }]),
          withSlots('Text', 'c1'),
          withSlots('Icon', 'c2'),
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    stdin.write('\r'); // Enter on the first row (Card root).
    const out = lastFrame() ?? '';
    expect(out).toMatch(/▾ Card \(2 deps\)/);
    // Children visible under the expanded root.
    expect(out).toContain('Text');
    expect(out).toContain('Icon');
  });
});

describe('ScopeGateStep — closure-aware selection', () => {
  it('Space on a root selects every component in its closure', () => {
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
    // Cursor starts on the first row (Card root). Toggle OFF the whole
    // closure, then toggle it back ON, so we can assert closure-aware behavior.
    stdin.write(' '); // exclude Card + Text + Icon
    stdin.write(' '); // re-include Card + Text + Icon
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Text', 'Icon', 'Standalone']));
    expect(arg.rejected).not.toContain('Card');
    expect(arg.rejected).not.toContain('Text');
    expect(arg.rejected).not.toContain('Icon');
  });

  it('Space on a root can exclude every component in its closure at once', () => {
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
    stdin.write(' '); // Space on Card root — excludes Card + Text + Icon.
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
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
    // Rows in tier order: Card root (idx 0), Standalone (idx 1).
    // Move cursor to Standalone.
    stdin.write('j');
    stdin.write(' '); // toggle Standalone off (was on by default).
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(['Standalone']);
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Text']));
    expect(arg.accepted).not.toContain('Standalone');
  });

  it('Space on a group-child (inside an expanded root) is a no-op', () => {
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
    // Expand the group so Text becomes a child row underneath Card.
    stdin.write('\r'); // Enter on Card root — expand.
    stdin.write('j'); // move to child (Text).
    stdin.write(' '); // no-op per spec.
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    // Both stay included — child-row Space did nothing.
    expect(arg.rejected).toEqual([]);
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Text']));
  });
});
