import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { FinalizeDialog } from '../../../../src/analyze/select/tui/components/FinalizeDialog.js';

describe('FinalizeDialog', () => {
  it('shows unresolved warning when needsReview > 0', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={5} rejected={2} needsReview={3} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('unresolved');
    expect(frame).toMatch(/will not be pushed|only accepted/i);
  });

  it('omits warning when needsReview === 0', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={5} rejected={2} needsReview={0} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('All components');
    expect(frame).not.toMatch(/will not be pushed/i);
  });

  it('calls onConfirm when y is pressed', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <FinalizeDialog accepted={5} rejected={2} needsReview={0} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 30));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when n is pressed', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <FinalizeDialog accepted={5} rejected={2} needsReview={0} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 30));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders accepted, rejected, and unresolved categories separately', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={10} rejected={1} needsReview={2} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('10 accepted');
    expect(frame).toContain('1 rejected');
    expect(frame).toContain('2 unresolved');
  });

  it('warns that unresolved components will not be pushed', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={10} rejected={0} needsReview={2} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    // Make the strict opt-in semantics explicit to the operator.
    expect(frame).toMatch(/will not be pushed|only accepted/i);
  });

  it('lists server-removed components (will be DELETED) when removed is non-empty', () => {
    const { lastFrame } = render(
      <FinalizeDialog
        accepted={3}
        rejected={0}
        needsReview={0}
        removed={[
          { id: 'card-1', name: 'Card' },
          { id: 'hero-1', name: 'Hero' },
        ]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Removed components \(2\)/);
    expect(frame).toContain('DELETE');
    expect(frame).toContain('Card');
    expect(frame).toContain('Hero');
  });

  it('omits the removed section when removed is empty (e.g. --no-push, no live preview)', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={3} rejected={0} needsReview={0} removed={[]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(lastFrame() ?? '').not.toMatch(/Removed components/);
  });

  it('shows a spinner (not the list) while the deletion preview is running', () => {
    const { lastFrame } = render(
      <FinalizeDialog
        accepted={3}
        rejected={0}
        needsReview={0}
        previewStatus="running"
        removed={[{ id: 'c1', name: 'Card' }]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Previewing deletions/i);
    expect(frame).not.toMatch(/Removed components/);
  });

  it('windows a long removed list and advertises [j/k] scroll', () => {
    const removed = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Comp${i}` }));
    const { lastFrame } = render(
      <FinalizeDialog
        accepted={1}
        rejected={0}
        needsReview={0}
        previewStatus="done"
        removed={removed}
        removedScrollOffset={0}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Removed components \(10\)/);
    expect(frame).toMatch(/\[j\/k\] scroll/);
    expect(frame).toMatch(/more below/);
    // Only the first window is shown; a later one is scrolled off.
    expect(frame).toContain('Comp0');
    expect(frame).not.toContain('Comp9');
  });

  it('honors removedScrollOffset to reveal later removed entries', () => {
    const removed = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Comp${i}` }));
    const { lastFrame } = render(
      <FinalizeDialog
        accepted={1}
        rejected={0}
        needsReview={0}
        previewStatus="done"
        removed={removed}
        removedScrollOffset={4}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/more above/);
    expect(frame).toContain('Comp9');
    expect(frame).not.toContain('Comp0');
  });

  it('warns when nothing is accepted', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={0} rejected={5} needsReview={7} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/No components are accepted/);
    expect(frame).toMatch(/Confirm exit with nothing accepted/);
  });

  it('calls onCancel when Esc is pressed', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <FinalizeDialog accepted={5} rejected={2} needsReview={0} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    stdin.write('\x1b');
    await new Promise((r) => setTimeout(r, 30));
    expect(onCancel).toHaveBeenCalled();
  });
});
