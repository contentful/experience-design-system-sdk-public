import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoodbyeBoundary, renderWithGoodbye, useScreenTransitionClear } from '../../src/tui/render-with-goodbye.js';

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
    const instance = render(
      <GoodbyeBoundary>
        <Text>Active view</Text>
      </GoodbyeBoundary>,
    );

    await new Promise((resolve) => setImmediate(resolve));
    instance.stdin.write('\x03');
    await new Promise((resolve) => setImmediate(resolve));

    expect(instance.lastFrame()).toContain('Goodbye!');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(exit).toHaveBeenCalledWith(0);
    instance.unmount();
  });

  it('exposes the mounted Ink instance clear operation through the transition hook', async () => {
    function ClearOnMount(): ReactElement {
      const clearScreen = useScreenTransitionClear();
      useEffect(() => {
        const timer = setTimeout(clearScreen, 0);
        return () => clearTimeout(timer);
      }, [clearScreen]);
      return <Text>Active view</Text>;
    }

    const instance = renderWithGoodbye(<ClearOnMount />, { patchConsole: false });
    const clear = vi.spyOn(instance, 'clear');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(clear).toHaveBeenCalledTimes(1);
    instance.unmount();
  });
});
