import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep', () => {
  it('renders all component names', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={FIXTURE}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    expect(out).toContain('Junk');
  });

  it('calls onConfirm with all-accepted on Enter when no toggles happened', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('\r'); // Enter
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('toggles selection with Space and confirms with Enter', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Move down twice (j) to land on 'Junk' then Space to deselect
    stdin.write('j');
    stdin.write('j');
    stdin.write(' ');
    stdin.write('\r');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Card'],
      rejected: ['Junk'],
    });
  });

  it("'n' deselects all and 'a' re-selects all", () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('n');
    stdin.write('\r');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: [],
      rejected: ['Button', 'Card', 'Junk'],
    });

    stdin.write('a');
    stdin.write('\r');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('calls onQuit on q', () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={onQuit} />,
    );
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
