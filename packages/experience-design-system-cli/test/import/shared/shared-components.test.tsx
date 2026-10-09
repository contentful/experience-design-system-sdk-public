import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ErrorStep, GateStep, RunningStep } from '../../../src/tui/import/shared/index.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const plain = (frame: string | undefined): string => (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
async function mount(element: React.ReactElement) {
  const view = render(element);
  await tick();
  return view;
}
const press = async (stdin: { write: (value: string) => void }, key: string) => {
  stdin.write(key);
  await tick();
};
const ENTER = '\r';
const ESC = '\u001B';

describe('GateStep', () => {
  it('shows the message, summary, context and hints', async () => {
    const { lastFrame } = await mount(
      <GateStep
        message="Tokens ready"
        summary="12 tokens"
        context="Reuse them?"
        onContinue={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    const frame = plain(lastFrame());
    expect(frame).toContain('✓ Tokens ready');
    expect(frame).toContain('12 tokens');
    expect(frame).toContain('Reuse them?');
    expect(frame).toContain('[Enter] Continue');
    expect(frame).toContain('[Esc] Quit');
    expect(frame).not.toContain('[a]');
  });

  it('continues on Enter, quits on Esc, and calls no process.exit', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const onContinue = vi.fn();
    const onQuit = vi.fn();
    const { stdin } = await mount(<GateStep message="Ready" onContinue={onContinue} onQuit={onQuit} />);
    await press(stdin, ENTER);
    await press(stdin, ESC);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('offers and runs the skip action when one is provided', async () => {
    const onSkip = vi.fn();
    const { stdin, lastFrame } = await mount(
      <GateStep message="Ready" skipLabel="Regenerate" onContinue={vi.fn()} onSkip={onSkip} onQuit={vi.fn()} />,
    );
    expect(plain(lastFrame())).toContain('[a] Regenerate');
    await press(stdin, 'a');
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('renders the error intent', async () => {
    const { lastFrame } = await mount(
      <GateStep message="Something is off" intent="error" onContinue={vi.fn()} onQuit={vi.fn()} />,
    );
    expect(plain(lastFrame())).toContain('✗ Something is off');
  });
});

describe('ErrorStep', () => {
  it('shows the failed step, message and a single exit hint', async () => {
    const { lastFrame } = await mount(<ErrorStep stepName="apply preview" message="Boom" onExit={vi.fn()} />);
    const frame = plain(lastFrame());
    expect(frame).toContain('✗ apply preview failed');
    expect(frame).toContain('Boom');
    expect(frame).toContain('[Enter] Exit');
    expect(frame).not.toContain('Re-enter credentials');
  });

  it('exits on Enter and Esc', async () => {
    const onExit = vi.fn();
    const { stdin } = await mount(<ErrorStep stepName="x" message="y" onExit={onExit} />);
    await press(stdin, ENTER);
    await press(stdin, ESC);
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it('acknowledges breaking changes on Enter and still exits on Esc', async () => {
    const onExit = vi.fn();
    const onAcknowledge = vi.fn();
    const { stdin, lastFrame } = await mount(
      <ErrorStep stepName="x" message="y" onExit={onExit} onAcknowledgeBreakingChanges={onAcknowledge} />,
    );
    expect(plain(lastFrame())).toContain('[Enter] Acknowledge and apply');
    await press(stdin, ENTER);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    await press(stdin, ESC);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers retry only when a retry callback is given', async () => {
    const onRetry = vi.fn();
    const { stdin, lastFrame } = await mount(
      <ErrorStep stepName="x" message="y" onExit={vi.fn()} onRetryCredentials={onRetry} />,
    );
    expect(plain(lastFrame())).toContain('[r] Re-enter credentials');
    await press(stdin, 'r');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('RunningStep', () => {
  it('takes the step number and total from props', async () => {
    const { lastFrame } = await mount(
      <RunningStep stepNumber={3} totalSteps={7} title="Generating" description="Working on it" />,
    );
    const frame = plain(lastFrame());
    expect(frame).toContain('Step 3 of 7 — Generating');
    expect(frame).toContain('Working on it');
    expect(frame).toContain('Running...');
    expect(frame).toContain('Elapsed: 0s');
  });

  it('renders completed lines, spinner lines and progress lines', async () => {
    const { lastFrame } = await mount(
      <RunningStep
        stepNumber={1}
        totalSteps={2}
        title="Extracting"
        description="Scanning"
        lines={[
          { text: 'Scan finished', complete: true },
          { text: 'Selecting components', progress: { done: 2, total: 8 } },
          { text: 'Composition mapping' },
        ]}
      />,
    );
    const frame = plain(lastFrame());
    expect(frame).toContain('✓ Scan finished');
    expect(frame).toContain('2/8');
    expect(frame).toContain('Selecting components');
    expect(frame).toContain('Composition mapping');
  });
});
