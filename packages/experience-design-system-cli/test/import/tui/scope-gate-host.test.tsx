import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateHost } from '../../../src/import/tui/scope-gate-host.js';

const TWO = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
];

describe('ScopeGateHost', () => {
  it('renders the interactive checklist when autoAccept is false', () => {
    const { lastFrame } = render(
      <ScopeGateHost components={TWO} autoAccept={false} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    expect(out).toContain('confirm'); // keybinding hint, not present in auto-accept mode
  });

  it('fires onConfirm with all-accepted on mount when autoAccept is true (no user input)', async () => {
    const onConfirm = vi.fn();
    render(<ScopeGateHost components={TWO} autoAccept onConfirm={onConfirm} onQuit={() => {}} />);
    await new Promise((r) => setImmediate(r));
    expect(onConfirm).toHaveBeenCalledWith({ accepted: ['Button', 'Card'], rejected: [] });
  });

  it('renders an error message when components is empty', () => {
    const { lastFrame } = render(
      <ScopeGateHost components={[]} autoAccept={false} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/no components/i);
  });
});
