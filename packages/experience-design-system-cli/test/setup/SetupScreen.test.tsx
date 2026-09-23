import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SetupScreen, formatSetupCompletionMessage, type SetupResultEntry } from '../../src/setup/SetupScreen.js';
import { waitForFrame } from '../helpers/wait-for-frame.js';
import { acceptDefault, choose } from './steps/select-helpers.js';

/**
 * Each step now reads and writes for itself, so the wizard's own tests stub the
 * modules the steps reach for rather than injecting one dependency bag.
 */
const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const shell = vi.hoisted(() => ({
  binaryExists: vi.fn(),
  pathExists: vi.fn(),
  runSpawn: vi.fn(),
  REQUIRED_NODE_MAJOR: 24,
}));

vi.mock('../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

vi.mock('../../src/setup/lib/shell.js', () => shell);

function resetMocks(): void {
  store.read.mockReset().mockResolvedValue({ spaceId: '', environmentId: '', cmaToken: '' });
  store.write.mockReset().mockResolvedValue(undefined);
  shell.binaryExists.mockReset().mockImplementation(async (binary: string) => binary === 'pnpm');
  shell.pathExists.mockReset().mockResolvedValue(false);
  shell.runSpawn.mockReset().mockResolvedValue({ exitCode: 0, stdout: '10.0.0\n', stderr: '' });
}

function renderScreen(props: Partial<React.ComponentProps<typeof SetupScreen>> = {}) {
  resetMocks();
  const onComplete = vi.fn();
  const result = render(
    <SetupScreen version="2.32.0" repoRoot="/repo" columns={120} onComplete={onComplete} {...props} />,
  );
  return { ...result, onComplete };
}

const ALL_SKIPPED = { skipAgent: true, skipCredentials: true, skipOptional: true } as const;

describe('SetupScreen', () => {
  it('renders the header with the CLI version and the four-step stepper', async () => {
    const { lastFrame } = renderScreen({ skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('experiences setup'),
    );

    expect(frame).toContain('v2.32.0');
    expect(frame).toContain('1 Prerequisites');
    expect(frame).toContain('2 Coding agent');
    expect(frame).toContain('3 Contentful');
    expect(frame).toContain('4 Preferences');
  });

  it('marks the active step and leaves later steps unmarked on the first screen', async () => {
    const { lastFrame } = renderScreen({ skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[1 Prerequisites]'),
    );

    expect(frame).not.toContain('✓ Prerequisites');
  });

  it('renders no step label or subtitle above the stepper', async () => {
    const { lastFrame } = renderScreen({ skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[1 Prerequisites]'),
    );

    expect(frame).not.toContain('[1/4]');
    expect(frame).not.toContain('· required');
    expect(frame).not.toContain('Prepare this machine');
  });

  it('uses the compact numbered stepper on narrow terminals', async () => {
    const { lastFrame } = renderScreen({ columns: 40, skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[1]'),
    );

    expect(frame).toContain('[1]  2  3  4');
  });

  it('pushes the version to the right edge when the terminal is wide', async () => {
    const { lastFrame } = renderScreen({ columns: 60, skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('v2.32.0'),
    );

    // 60 columns minus one column of padding on each side.
    expect(frame.split('\n')[0]).toBe(
      ` experiences setup${' '.repeat(58 - 'experiences setup'.length - 'v2.32.0'.length)}v2.32.0`,
    );
  });

  it('keeps the version inline when the terminal is too narrow to right-align it', async () => {
    const { lastFrame } = renderScreen({ columns: 24, skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('v2.32.0'),
    );

    expect(frame).toContain('experiences setup v2.32.0');
  });

  it('reports prerequisite progress as each check finishes', async () => {
    const { frames } = renderScreen({ skip: ALL_SKIPPED });

    const history = await waitForFrame(
      () => frames.join('\n'),
      (f) => f.includes('CLI built successfully'),
    );

    expect(history).toContain('Node.js v');
    expect(history).toContain('pnpm v10.0.0 — already installed');
    expect(history).toContain('Dependencies installed');
  });

  it('completes the prerequisite step and advances through the wizard', async () => {
    const { lastFrame } = renderScreen({ skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    expect(frame).toContain('✓ Prerequisites');
    expect(frame).toContain('✓ Coding agent');
  });

  it('shows the final summary with completed and skipped actions', async () => {
    const { lastFrame, onComplete } = renderScreen({ skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    expect(frame).toContain('✓ Node.js 24+');
    expect(frame).toContain('✓ pnpm');
    expect(frame).toContain('– Coding agent — skipped');
    expect(frame).toContain('– Contentful credentials — skipped');
    expect(frame).toContain('– Preferences — skipped');
    expect(frame).toContain('✓ Setup complete. You can now run: experiences import');
    expect(frame).toContain('Run experiences doctor any time to re-check.');

    expect(onComplete).toHaveBeenCalledWith({ results: expect.any(Array), exitCode: 0 });
  });

  it('reports a failed required action and a non-zero exit code', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({ skip: ALL_SKIPPED });
    shell.binaryExists.mockResolvedValue(false);
    shell.runSpawn.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install pnpm via npm?'),
    );
    stdin.write('y');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('required step'),
    );

    expect(frame).toContain('✗ pnpm — required');
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
  });

  it('finishes on the summary without asking to run doctor', async () => {
    const { lastFrame, onComplete } = renderScreen({ skip: ALL_SKIPPED });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    // One summary and done: doctor would repeat the install and build setup
    // just ran, so it is left for the operator to run later.
    expect(frame).not.toContain('Run experiences doctor now');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('opens preferences on a menu rather than walking each setting', async () => {
    const { lastFrame } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );

    // Every preference is listed with its current value, and none of their
    // prompts has been asked yet.
    expect(frame).toContain('AI auto-filter');
    expect(frame).toContain('Debug logging');
    expect(frame).toContain('Done');
    expect(frame).not.toContain('Filters out components irrelevant to experience orchestration');
  });

  it('returns to the menu after a preference is changed', async () => {
    const { lastFrame, stdin } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    // The first row leads the menu, so accepting opens AI auto-filter.
    await acceptDefault(stdin);
    const opened = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    expect(opened).not.toContain('Preferences — open one');

    await acceptDefault(stdin);
    const back = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    expect(back).toContain('AI auto-filter');
  });

  it('leaves preferences skipped when the operator chooses Done without changing anything', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({
      skip: { skipAgent: true, skipCredentials: true },
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await choose(stdin, lastFrame, 'Done', 8);

    await waitForFrame(
      () => (onComplete.mock.calls.length > 0 ? 'done' : ''),
      (f) => f === 'done',
    );
    const outcome = onComplete.mock.calls[0]![0] as { results: Array<{ name: string; status: string }> };
    expect(outcome.results.find((result) => result.name === 'Preferences')?.status).toBe('skipped');
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('formatSetupCompletionMessage', () => {
  const results: SetupResultEntry[] = [
    { name: 'Node.js 24+', status: 'completed', required: true },
    { name: 'pnpm', status: 'completed', required: true },
    { name: 'coding agent', status: 'skipped', required: false },
    { name: 'Contentful credentials', status: 'failed', required: false },
  ];

  it('ignores optional failures', () => {
    expect(formatSetupCompletionMessage(results)).toBe('✓ Setup complete. You can now run: experiences import');
  });

  it('reports the number of incomplete required steps', () => {
    const withFailures: SetupResultEntry[] = [
      ...results,
      { name: 'install & build', status: 'failed', required: true },
    ];

    expect(formatSetupCompletionMessage(withFailures)).toBe('⚠ 1 required step incomplete.');
  });

  it('pluralizes multiple incomplete required steps', () => {
    const withFailures: SetupResultEntry[] = [
      { name: 'pnpm', status: 'failed', required: true },
      { name: 'install & build', status: 'failed', required: true },
    ];

    expect(formatSetupCompletionMessage(withFailures)).toBe('⚠ 2 required steps incomplete.');
  });
});
