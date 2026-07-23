import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import {
  useOverlayPanel,
  type UseOverlayPanelOptions,
  type UseOverlayPanelResult,
} from '../../../../src/import/tui/hooks/useOverlayPanel.js';

function mountProbe(opts: UseOverlayPanelOptions): { current: UseOverlayPanelResult } {
  const ref: { current: UseOverlayPanelResult | null } = { current: null };
  function Probe(): React.ReactElement | null {
    ref.current = useOverlayPanel(opts);
    return React.createElement(Text, null, '');
  }
  render(React.createElement(Probe));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return ref as { current: UseOverlayPanelResult };
}

describe('useOverlayPanel', () => {
  it('initial state is closed', () => {
    const hook = mountProbe({ toggleKey: 'c' });
    expect(hook.current.isOpen).toBe(false);
  });

  it('open() opens the panel', () => {
    const hook = mountProbe({ toggleKey: 'c' });
    hook.current.open();
    expect(hook.current.isOpen).toBe(true);
  });

  it('close() closes the panel', () => {
    const hook = mountProbe({ toggleKey: 'c' });
    hook.current.open();
    expect(hook.current.isOpen).toBe(true);
    hook.current.close();
    expect(hook.current.isOpen).toBe(false);
  });

  it('handleInput(toggleKey) when open: consumes and closes', () => {
    const hook = mountProbe({ toggleKey: 'c' });
    hook.current.open();
    const consumed = hook.current.handleInput('c', { escape: false });
    expect(consumed).toBe(true);
    expect(hook.current.isOpen).toBe(false);
  });

  it('handleInput(toggleKey) when closed: returns false and does NOT open (opening is caller-owned)', () => {
    const hook = mountProbe({ toggleKey: 'c' });
    const consumed = hook.current.handleInput('c', { escape: false });
    expect(consumed).toBe(false);
    expect(hook.current.isOpen).toBe(false);
  });

  it('handleInput with Esc when open: consumes and closes regardless of input char', () => {
    const hook = mountProbe({ toggleKey: 'c' });
    hook.current.open();
    const consumed = hook.current.handleInput('', { escape: true });
    expect(consumed).toBe(true);
    expect(hook.current.isOpen).toBe(false);
  });

  it('handleInput with a non-toggle key when open: returns false and stays open', () => {
    const hook = mountProbe({ toggleKey: 'd' });
    hook.current.open();
    const consumed = hook.current.handleInput('c', { escape: false });
    expect(consumed).toBe(false);
    expect(hook.current.isOpen).toBe(true);
  });

  it('onClose fires when handleInput closes the panel via toggleKey', () => {
    const onClose = vi.fn();
    const hook = mountProbe({ toggleKey: 'd', onClose });
    hook.current.open();
    hook.current.handleInput('d', { escape: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onClose fires when handleInput closes via Esc', () => {
    const onClose = vi.fn();
    const hook = mountProbe({ toggleKey: 'd', onClose });
    hook.current.open();
    hook.current.handleInput('', { escape: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onClose does NOT fire when handleInput ignores a key (panel closed, or wrong key)', () => {
    const onClose = vi.fn();
    const hook = mountProbe({ toggleKey: 'd', onClose });
    hook.current.handleInput('d', { escape: false });
    hook.current.open();
    hook.current.handleInput('x', { escape: false });
    expect(onClose).not.toHaveBeenCalled();
  });
});
