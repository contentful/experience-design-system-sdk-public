import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoodbyeBoundary } from '../../src/tui/render-with-goodbye.js';

describe('renderWithGoodbye', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the active view before exiting on SIGINT', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const instance = render(
      <GoodbyeBoundary>
        <Text>Active view</Text>
      </GoodbyeBoundary>,
    );

    expect(instance.lastFrame()).toContain('Active view');

    await new Promise((resolve) => setImmediate(resolve));
    process.emit('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));

    expect(instance.lastFrame()).toContain('Goodbye!');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(exit).toHaveBeenCalledWith(0);
    instance.unmount();
  });

  it('replaces the active view when raw terminal input reports Ctrl+C', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const instance = render(<GoodbyeBoundary><Text>Active view</Text></GoodbyeBoundary>);

    await new Promise((resolve) => setImmediate(resolve));
    instance.stdin.write('\x03');
    await new Promise((resolve) => setImmediate(resolve));

    expect(instance.lastFrame()).toContain('Goodbye!');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(exit).toHaveBeenCalledWith(0);
    instance.unmount();
  });
});
