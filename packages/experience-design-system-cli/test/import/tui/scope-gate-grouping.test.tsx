import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

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
    expect(out).toContain('Standalone');
    expect(out).not.toMatch(/[▸▾] Standalone/);
    expect(out).toContain('Text');
    expect(out).toContain('Icon');
  });
});

describe('ScopeGateStep — cycle-member injection under composite parents', () => {
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
    expect(out).toContain('InnerA');
    expect(out).toContain('InnerB');
    expect(out).toMatch(/Wrapper1/);
    expect(out).toMatch(/Wrapper2/);
    const innerAMatches = out.match(/InnerA/g) ?? [];
    expect(innerAMatches.length).toBeGreaterThan(1);
    expect(out).toMatch(/⚠ InnerA \(cycle\)/);
  });
});

describe('ScopeGateStep — cycle-tier subtree expansion (task 35)', () => {
  it('renders slot targets inline under an expanded cycle row', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          withSlots('NodeA', 'c0', [{ name: 's', allowedComponents: ['NodeB'] }]),
          withSlots('NodeB', 'c1', [{ name: 's', allowedComponents: ['NodeA'] }]),
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/▾.*⚠.*NodeA/);
    expect(out).toMatch(/▾.*⚠.*NodeB/);
    expect(out).toMatch(/[├└]─/);
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
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Text', 'Icon']));
    expect(arg.rejected).toEqual(['Standalone']);
  });

  it('Rejecting an accepted root deselects its descendants (undecided → partitions to rejected)', () => {
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
    stdin.write('A');
    stdin.write('r');
    stdin.write('y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Text', 'Icon']));
    expect(arg.accepted).toEqual(['Standalone']);
  });

  it('[a] on a standalone accepts only that component', () => {
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
    stdin.write('j');
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toEqual(['Standalone']);
    expect(arg.rejected).toEqual(expect.arrayContaining(['Card', 'Text']));
  });

  it('Rejecting an accepted group-child cascades to ancestors (blast radius 1 = no prompt)', () => {
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
    stdin.write('A');
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toEqual(expect.arrayContaining(['Text', 'Card']));
    expect(arg.accepted).toEqual([]);
  });
});
