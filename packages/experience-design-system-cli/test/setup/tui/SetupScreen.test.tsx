import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../../../src/setup/tui/SetupScreen.js';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { acceptDefault } from '../steps/select-helpers.js';

/**
 * Each step now reads and writes for itself, so the wizard's own tests stub the
 * modules the steps reach for rather than injecting one dependency bag.
 */
const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const shell = vi.hoisted(() => ({
  binaryExists: vi.fn(),
  pathExists: vi.fn(),
  runSpawn: vi.fn(),
  profileContains: vi.fn(),
  appendToProfile: vi.fn(),
  detectShellProfile: vi.fn(),
  REQUIRED_NODE_MAJOR: 24,
}));

vi.mock('../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

vi.mock('../../../src/setup/lib/shell.js', () => shell);

function resetMocks(): void {
  store.read.mockReset().mockResolvedValue({ spaceId: '', environmentId: '', cmaToken: '' });
  store.write.mockReset().mockResolvedValue(undefined);
  shell.binaryExists.mockReset().mockImplementation(async (binary: string) => binary === 'pnpm');
  shell.pathExists.mockReset().mockResolvedValue(false);
  shell.runSpawn.mockReset().mockResolvedValue({ exitCode: 0, stdout: '10.0.0\n', stderr: '' });
  shell.profileContains.mockReset().mockResolvedValue(false);
  shell.appendToProfile.mockReset().mockResolvedValue(undefined);
  shell.detectShellProfile.mockReset().mockResolvedValue('/home/tester/.zshrc');
}

function renderScreen(props: Partial<React.ComponentProps<typeof SetupScreen>> = {}) {
  resetMocks();
  const onComplete = vi.fn();
  const result = render(
    <SetupScreen
      version="2.32.0"
      repoRoot="/repo"
      profilePath="/home/tester/.zshrc"
      columns={120}
      onComplete={onComplete}
      {...props}
    />,
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

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 0, restartRequired: false, runDoctor: false }),
    );
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

  it('offers experiences doctor after the summary when asked to', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({ offerDoctor: true, skip: ALL_SKIPPED });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Run experiences doctor now'),
    );
    stdin.write('y');

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ runDoctor: true, exitCode: 0 }));
  });

  it('walks every preference in order without asking which to configure', async () => {
    const { lastFrame } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AI auto-filter'),
    );

    expect(frame).not.toContain('Choose preferences to configure');
    expect(frame).toContain('Filters out components irrelevant to experience orchestration');
  });

  it('clears a finished preference from the screen before the next one', async () => {
    const { lastFrame, stdin } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    await acceptDefault(stdin);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Analyzes more components at once'),
    );
    expect(frame).not.toContain('Filters out components irrelevant');
  });
});
