import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

// Pilot-testing invariant pinned by commit f49dc00:
// "Scope-gate keymap is a / A / r / f / F / q (NOT Space/Enter/n)."
//
// Feature 3 added a `c` keystroke for the AI-excluded section collapse and a
// conditional `q` route to onCancelAutoFilter while auto-filter is running.
// Neither addition is allowed to regress the existing keymap when there are
// no AI-excluded components (i.e., legacy / no-auto-filter / pre-Feature-3
// behavior).

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep keymap regression — pre-Feature-3 behavior preserved', () => {
  it('a toggles the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('a'); // toggle Button off
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].rejected).toContain('Button');
  });

  it('A toggles all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].rejected).toEqual(['Button', 'Card', 'Junk']);
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

  it('Space and Enter and n do NOT toggle (pinned non-bindings)', () => {
    const onConfirm = vi.fn();
    const onQuit = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={onQuit} />);
    stdin.write(' ');
    stdin.write('\r');
    stdin.write('n');
    // None of these confirm or quit — only f/F/q do.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
  });
});
