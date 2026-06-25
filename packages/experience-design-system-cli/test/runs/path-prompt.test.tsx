import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../helpers/wait-for-frame.js';
import { PathPrompt } from '../../src/runs/path-prompt.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('PathPrompt', () => {
  it('renders prompt with default path pre-filled', async () => {
    const { lastFrame } = render(
      <PathPrompt defaultPath="/work/foo/dist" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('/work/foo/dist'),
      3000,
    );
    expect(frame).toContain('Save to');
    expect(frame).toContain('/work/foo/dist');
  });

  it('submits the default path when Enter is pressed without typing', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <PathPrompt defaultPath="/work/foo/dist" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await waitForFrame(() => lastFrame(), (f) => f.includes('/work/foo/dist'), 3000);
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).toHaveBeenCalledWith('/work/foo/dist');
  });

  it('submits a typed path when Enter is pressed', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <PathPrompt defaultPath="/work/foo/dist" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await waitForFrame(() => lastFrame(), (f) => f.includes('/work/foo/dist'), 3000);
    stdin.write('/tmp/other');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).toHaveBeenCalledWith('/tmp/other');
  });

  it('fires onCancel on Esc', async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      <PathPrompt defaultPath="/work/foo/dist" onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    await waitForFrame(() => lastFrame(), (f) => f.includes('/work/foo/dist'), 3000);
    stdin.write('');
    await new Promise((r) => setTimeout(r, 50));
    expect(onCancel).toHaveBeenCalled();
  });
});
