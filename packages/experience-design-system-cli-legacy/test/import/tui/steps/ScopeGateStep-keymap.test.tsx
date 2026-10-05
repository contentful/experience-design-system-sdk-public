import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep keymap regression — pre-Feature-3 behavior preserved', () => {
  it('a accepts the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('a');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toContain('Button');
  });

  it('A on fresh state (all undecided) accepts all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
    expect(onConfirm.mock.calls[0][0].rejected).toEqual([]);
  });

  it('r rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('r');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].rejected).toContain('Button');
  });

  it('f confirms', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('F (capital) also confirms', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('F');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('q quits when no auto-filter is running', () => {
    const onQuit = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={onQuit} />);
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('Space does NOT accept the cursor component (L9 rebind: space = collapse)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write(' ');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).not.toContain('Button');
  });

  it('Y accepts every non-cycle-participant that is not AI-flagged', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('Y');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toEqual(expect.arrayContaining(['Button', 'Card', 'Junk']));
  });

  it('Enter and n do NOT confirm or quit (pinned non-bindings)', () => {
    const onConfirm = vi.fn();
    const onQuit = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={onQuit} />);
    stdin.write('\r');
    stdin.write('n');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
  });
});
