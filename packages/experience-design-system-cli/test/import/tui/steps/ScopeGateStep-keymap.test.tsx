import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

// Pilot-2026-06-25: scope-gate UX overhaul keymap.
// Active bindings: j/k (or arrows) move · a/Space accept · r reject ·
// A toggle-all · Y accept non-flagged · f/F confirm · q quit · s AI-reason
// side panel.
// Enter and `n` are NOT bindings. `c` is no longer bound (the separate AI-
// excluded section it controlled was removed).

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep keymap regression — pre-Feature-3 behavior preserved', () => {
  it('a accepts the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('a'); // accept Button
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toContain('Button');
  });

  it('A on fresh state (all undecided) accepts all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toEqual(
      expect.arrayContaining(['Button', 'Card', 'Junk']),
    );
    expect(onConfirm.mock.calls[0][0].rejected).toEqual([]);
  });

  it('r rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('r'); // reject Button
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

  it('Space accepts the cursor component (Space is an alias for [a])', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write(' '); // accept Button (same as [a])
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toContain('Button');
  });

  it('Y accepts every non-cycle-participant that is not AI-flagged', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />);
    stdin.write('Y');
    stdin.write('f');
    expect(onConfirm.mock.calls[0][0].accepted).toEqual(
      expect.arrayContaining(['Button', 'Card', 'Junk']),
    );
  });

  it('Enter and n do NOT confirm or quit (pinned non-bindings)', () => {
    const onConfirm = vi.fn();
    const onQuit = vi.fn();
    const { stdin } = render(<ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={onQuit} />);
    stdin.write('\r');
    stdin.write('n');
    // Neither confirms or quits — only f/F/q do.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
  });
});
