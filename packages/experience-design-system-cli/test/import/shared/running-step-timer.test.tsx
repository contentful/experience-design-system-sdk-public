import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { useElapsed } from '../../../src/tui/import/shared/running-step/use-elapsed.js';
import { Text } from 'ink';

function Timer(): React.ReactElement {
  return <Text>{useElapsed()}</Text>;
}
afterEach(() => vi.useRealTimers());
it('uses elapsed wall time after a delayed timer callback', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(0);
  const ui = render(<Timer />);
  await new Promise((resolve) => setImmediate(resolve));
  vi.setSystemTime(195000);
  await vi.advanceTimersByTimeAsync(1000);
  await new Promise((resolve) => setImmediate(resolve));
  expect(ui.lastFrame()).toContain('3m 16s');
  ui.unmount();
});
