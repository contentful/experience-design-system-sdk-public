import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { PushDecisionGateStep } from '../../../../src/import/tui/steps/PushDecisionGateStep.js';

const DEFAULT_PROPS = {
  summary: '3 component definitions ready.',
  context: 'Save components.json and tokens.json to disk, push to your Contentful space, or both.',
  fileList: 'components.json and tokens.json',
};

describe('PushDecisionGateStep', () => {
  it('renders three options with cursor on "Save AND push" by default', () => {
    const { lastFrame } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Save AND push');
    expect(out).toContain('Push only');
    expect(out).toContain('Save only');
    const cursorLine = out.split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Save AND push');
  });

  it('renders the supplied summary and context', () => {
    const { lastFrame } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('3 component definitions ready.');
    expect(out).toContain('Save components.json and tokens.json to disk');
  });

  it('moves cursor down on j and up on k', () => {
    const onChoice = vi.fn();
    const { lastFrame, stdin } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={onChoice}
        onQuit={() => {}}
      />,
    );
    stdin.write('j');
    let cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Push only');
    stdin.write('j');
    cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Save only');
    stdin.write('k');
    cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Push only');
  });

  it('Enter fires onChoice with the currently selected value', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={onChoice}
        onQuit={() => {}}
      />,
    );
    stdin.write('\r');
    expect(onChoice).toHaveBeenCalledWith('both');
    stdin.write('j');
    stdin.write('\r');
    expect(onChoice).toHaveBeenLastCalledWith('push-only');
    stdin.write('j');
    stdin.write('\r');
    expect(onChoice).toHaveBeenLastCalledWith('save-only');
  });

  it('b shortcut fires onChoice("both") immediately regardless of cursor', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={onChoice}
        onQuit={() => {}}
      />,
    );
    stdin.write('j');
    stdin.write('b');
    expect(onChoice).toHaveBeenCalledWith('both');
  });

  it('p shortcut fires onChoice("push-only") immediately', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={onChoice}
        onQuit={() => {}}
      />,
    );
    stdin.write('p');
    expect(onChoice).toHaveBeenCalledWith('push-only');
  });

  it('s shortcut fires onChoice("save-only") immediately', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={onChoice}
        onQuit={() => {}}
      />,
    );
    stdin.write('s');
    expect(onChoice).toHaveBeenCalledWith('save-only');
  });

  it('q fires onQuit', () => {
    const onQuit = vi.fn();
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep
        {...DEFAULT_PROPS}
        onChoice={onChoice}
        onQuit={onQuit}
      />,
    );
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onChoice).not.toHaveBeenCalled();
  });
});
