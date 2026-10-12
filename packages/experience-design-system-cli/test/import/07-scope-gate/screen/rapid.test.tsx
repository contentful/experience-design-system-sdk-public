import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateScreen } from '../../../../src/tui/import/steps/07-scope-gate/screen.js';

const comp = (name: string, allowed: string[] = []) => ({
  name,
  componentId: name.toLowerCase(),
  aiDecision: null,
  aiReason: null,
  needsReview: false,
  slots: allowed.length ? [{ name: 'children', allowedComponents: allowed }] : [],
});
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('rapid input', () => {
  it('applies several decisions typed back to back without losing any', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateScreen
        components={[comp('A'), comp('B'), comp('C'), comp('D')]}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    await tick();
    // accept A, move down, accept B, move down, accept C, then finish — all in one burst
    stdin.write('a');
    stdin.write('\u001b[B');
    stdin.write('a');
    stdin.write('\u001b[B');
    stdin.write('a');
    stdin.write('f');
    await tick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({ accepted: ['A', 'B', 'C'], rejected: ['D'] });
  });

  it('rejects a parent and its dependency together, in one burst', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateScreen
        components={[comp('Page', ['Card']), comp('Card', ['Button']), comp('Button')]}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    await tick();
    stdin.write('A'); // accept everything
    stdin.write('f');
    await tick();
    expect(onConfirm.mock.calls[0][0].accepted.sort()).toEqual(['Button', 'Card', 'Page']);
  });
});
