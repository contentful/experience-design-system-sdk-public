import { render as inkRender } from 'ink-testing-library';

/**
 * The v2 test config forces colour on and legacy's turned it off, so frames carry colour codes, even between characters
 * that sit next to each other in plain text. Tests ported from legacy assert on plain text, so they render with this.
 */
export const stripAnsi = (text: string | undefined): string | undefined => text?.replace(/\u001b\[[0-9;]*m/g, '');

export const render = (...args: Parameters<typeof inkRender>): ReturnType<typeof inkRender> => {
  const instance = inkRender(...args);
  return {
    ...instance,
    lastFrame: () => stripAnsi(instance.lastFrame()),
    frames: instance.frames.map((frame) => stripAnsi(frame) ?? ''),
  } as ReturnType<typeof inkRender>;
};
