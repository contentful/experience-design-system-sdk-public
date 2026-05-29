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
    expect(frame).toContain('excluded from the output');
  });

  it('omits warning when needsReview === 0', () => {
    const { lastFrame } = render(
      <FinalizeDialog accepted={5} rejected={2} needsReview={0} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('All components');
    expect(frame).not.toContain('excluded from the output');
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
