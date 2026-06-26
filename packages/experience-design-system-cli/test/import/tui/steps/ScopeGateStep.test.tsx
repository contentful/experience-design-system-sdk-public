import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
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

  it('calls onConfirm with all-accepted on f when no toggles happened', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('toggles selection with a and confirms with f', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Move down twice (j) to land on 'Junk' then 'a' to toggle off
    stdin.write('j');
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Card'],
      rejected: ['Junk'],
    });
  });

  it('A toggles all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // First A: all currently included → flip to all rejected
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: [],
      rejected: ['Button', 'Card', 'Junk'],
    });

    // Second A: all currently rejected → flip back to all accepted
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('r explicitly rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts at Button. Move down once to land on Card, then reject it.
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Junk'],
      rejected: ['Card'],
    });
  });

  it('F (capital) also confirms', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('F');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
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
