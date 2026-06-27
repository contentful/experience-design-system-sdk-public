import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { PushDecisionGateStep } from '../../../../src/import/tui/steps/PushDecisionGateStep.js';

/**
 * Skip-credentials spec — Task 3. When the wizard was advanced via the
 * credentials-screen skip path, the push-decision-gate still renders all
 * three options for visual continuity, but "Save AND push" and "Push only"
 * are visibly disabled and unreachable. Only "Save only" can be selected.
 */

const DEFAULT_PROPS = {
  summary: '3 component definitions ready.',
  context: 'Save components.json and tokens.json to disk, push to your Contentful space, or both.',
  fileList: 'components.json and tokens.json',
};

describe('PushDecisionGateStep — pushDisabled', () => {
  it('renders disabled rows with the "unavailable — credentials skipped" suffix', () => {
    const { lastFrame } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Save AND push');
    expect(out).toContain('Push only');
    expect(out).toContain('Save only');
    expect(out).toContain('unavailable');
    expect(out).toContain('credentials skipped');
  });

  it('defaults the cursor to "Save only" when pushDisabled is true', () => {
    const { lastFrame } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={() => {}} onQuit={() => {}} />,
    );
    const cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Save only');
  });

  it('cursor cannot land on disabled rows via j or k', () => {
    const { lastFrame, stdin } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={() => {}} onQuit={() => {}} />,
    );
    // Cursor starts at save-only (index 2). k should be a no-op (or land on
    // a disabled row, in which case "›" must still be on Save only).
    stdin.write('k');
    let cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Save only');
    stdin.write('k');
    cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Save only');
    // j has nothing to move toward — stay on save-only.
    stdin.write('j');
    cursorLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('›')) ?? '';
    expect(cursorLine).toContain('Save only');
  });

  it('b shortcut is a no-op when pushDisabled is true', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={onChoice} onQuit={() => {}} />,
    );
    stdin.write('b');
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('p shortcut is a no-op when pushDisabled is true', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={onChoice} onQuit={() => {}} />,
    );
    stdin.write('p');
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('s shortcut still selects "save-only" when pushDisabled is true', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={onChoice} onQuit={() => {}} />,
    );
    stdin.write('s');
    expect(onChoice).toHaveBeenCalledWith('save-only');
  });

  it('Enter selects save-only (the default cursor) when pushDisabled is true', () => {
    const onChoice = vi.fn();
    const { stdin } = render(
      <PushDecisionGateStep {...DEFAULT_PROPS} pushDisabled onChoice={onChoice} onQuit={() => {}} />,
    );
    stdin.write('\r');
    expect(onChoice).toHaveBeenCalledWith('save-only');
  });
});
