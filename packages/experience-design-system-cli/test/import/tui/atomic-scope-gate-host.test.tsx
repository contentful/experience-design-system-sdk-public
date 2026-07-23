import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateHost } from '../../../src/import/tui/scope-gate-host.js';

const TWO = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
];

describe('ScopeGateHost — compositionMode fork', () => {
  it('atomic mode renders the flat step with NO hierarchy affordances', () => {
    const { lastFrame } = render(
      <ScopeGateHost
        components={TWO}
        autoAccept={false}
        compositionMode="atomic"
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    // components render
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    // flat-step chrome present
    expect(out).toContain('continue');
    // hierarchy affordances absent
    expect(out).not.toMatch(/Added groups/i);
    expect(out).not.toMatch(/Only cycles/i);
    expect(out).not.toMatch(/lineage/i);
    expect(out).not.toMatch(/\(cycle\)/i);
  });

  it('defaults to atomic when compositionMode is omitted', () => {
    const { lastFrame } = render(
      <ScopeGateHost components={TWO} autoAccept={false} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toMatch(/Added groups/i);
    expect(out).not.toMatch(/lineage/i);
  });

  it('composite mode renders the hierarchy-aware step', () => {
    const { lastFrame } = render(
      <ScopeGateHost
        components={TWO}
        autoAccept={false}
        compositionMode="composite"
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    // composite-only chrome (counter strip carries a Groups column)
    expect(out).toMatch(/Groups/i);
  });
});
