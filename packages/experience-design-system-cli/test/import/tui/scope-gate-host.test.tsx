import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateHost } from '../../../src/import/tui/scope-gate-host.js';

const TWO = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
];

describe('ScopeGateHost', () => {
  it('renders the interactive checklist', () => {
    const { lastFrame } = render(<ScopeGateHost components={TWO} onConfirm={() => {}} onQuit={() => {}} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    expect(out).toContain('continue'); // keybinding hint, not present in auto-accept mode
  });

  it('renders an error message when components is empty', () => {
    const { lastFrame } = render(<ScopeGateHost components={[]} onConfirm={() => {}} onQuit={() => {}} />);
    const out = lastFrame() ?? '';
    expect(out).toMatch(/no components/i);
  });
});
