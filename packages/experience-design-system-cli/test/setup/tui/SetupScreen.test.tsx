import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { ExperiencesCredentials } from '../../../src/credentials-store.js';
import { SetupScreen, type SetupScreenDependencies } from '../../../src/setup/tui/SetupScreen.js';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

function createDependencies(overrides: Partial<SetupScreenDependencies> = {}): SetupScreenDependencies {
  let credentials: ExperiencesCredentials = { spaceId: '', environmentId: '', cmaToken: '' };
  return {
    nodeVersion: '24.18.1',
    homeDir: '/home/tester',
    env: {},
    binaryExists: async (binary) => binary === 'pnpm',
    run: async () => ({ exitCode: 0, stdout: '10.0.0\n', stderr: '' }),
    pathExists: async () => false,
    profileContains: async () => false,
    appendToProfile: async () => undefined,
    readCredentials: async () => credentials,
    writeCredentials: async (next) => {
      credentials = next;
    },
    credentialsPath: () => '/home/tester/.config/experiences/credentials.json',
    ...overrides,
  };
}

function renderScreen(
  props: Partial<React.ComponentProps<typeof SetupScreen>> = {},
): ReturnType<typeof render> & { onComplete: ReturnType<typeof vi.fn> } {
  const onComplete = vi.fn();
  const result = render(
    <SetupScreen
      version="2.32.0"
      repoRoot="/repo"
      profilePath="/home/tester/.zshrc"
      dependencies={createDependencies()}
      columns={120}
      onComplete={onComplete}
      {...props}
    />,
  );
  return { ...result, onComplete };
}

async function answer(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  stdin.write(`${text}\r`);
  await new Promise((resolve) => setTimeout(resolve, 20));
}

// Each screen clears its action log when the next step begins, so transient
// progress only survives in the frame history.
function waitForHistory(
  frames: () => string[],
  condition: (history: string) => boolean,
  timeout = 5000,
): Promise<string> {
  return waitForFrame(() => frames().join('\n'), condition, timeout);
}

describe('SetupScreen', () => {
  it('renders the header with the CLI version and the four-step stepper', async () => {
    const { lastFrame } = renderScreen();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('experiences setup'),
    );

    expect(frame).toContain('experiences setup');
    expect(frame).toContain('v2.32.0');
    expect(frame).toContain('1 Prerequisites');
    expect(frame).toContain('2 Coding agent');
    expect(frame).toContain('3 Contentful');
    expect(frame).toContain('4 Preferences');
  });

  it('marks the active step and leaves later steps unmarked on the first screen', async () => {
    const { lastFrame } = renderScreen();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[1 Prerequisites]'),
    );

    expect(frame).toContain('[1 Prerequisites]');
    expect(frame).not.toContain('✓ Prerequisites');
  });

  it('renders a blank spacer line after the credentials path notice', async () => {
    const { lastFrame } = renderScreen({ skip: { skipAgent: true } });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Current values') || f.includes('Configure Contentful credentials?'),
    );

    // The notice wraps, so the spacer follows its last wrapped line.
    const lines = frame.split('\n');
    const noticeEnd = lines.findIndex((line) => line.trim().endsWith('import.'));
    expect(noticeEnd).toBeGreaterThanOrEqual(0);
    expect(lines[noticeEnd + 1]!.trim()).toBe('');
  });

  it('renders no step label or subtitle above the stepper', async () => {
    const { lastFrame } = renderScreen();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[1 Prerequisites]'),
    );

    expect(frame).not.toContain('[1/4]');
    expect(frame).not.toContain('· required');
    expect(frame).not.toContain('Prepare this machine');
  });

  it('uses the compact numbered stepper on narrow terminals', async () => {
    const { lastFrame } = renderScreen({ columns: 40 });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[1]'),
    );

    expect(frame).toContain('[1]  2  3  4');
    expect(frame).not.toContain('Prerequisites ·  2');
  });

  it('keeps the version inline when the terminal is too narrow to right-align it', async () => {
    const { lastFrame } = renderScreen({ columns: 24 });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('v2.32.0'),
    );

    expect(frame).toContain('experiences setup v2.32.0');
  });

  it('reports prerequisite progress from the setup actions', async () => {
    const { frames } = renderScreen({ skip: { skipAgent: true, skipCredentials: true, skipOptional: true } });

    const history = await waitForHistory(
      () => frames,
      (f) => f.includes('CLI built successfully'),
    );

    expect(history).toContain('Node.js v24.18.1 — already good');
    expect(history).toContain('pnpm v10.0.0 — already installed');
    expect(history).toContain('Dependencies installed');
    expect(history).toContain('CLI built successfully');
  });

  it('completes the prerequisite step and advances to the coding agent step', async () => {
    const { lastFrame } = renderScreen({ skip: { skipAgent: true } });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[3 Contentful]'),
    );

    expect(frame).toContain('✓ Prerequisites');
    expect(frame).toContain('✓ Coding agent');
    expect(frame).toContain('[3 Contentful]');
  });

  it('prompts for text input and feeds the typed answer back to the action', async () => {
    const { lastFrame, stdin } = renderScreen({
      dependencies: createDependencies({ binaryExists: async (binary) => binary === 'pnpm' || binary === 'codex' }),
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Model name'),
    );

    stdin.write('gpt-next');
    const typed = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('gpt-next'),
    );
    expect(typed).toContain('gpt-next');

    await answer(stdin, '');
    const advanced = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[3 Contentful]'),
    );
    expect(advanced).toContain('[3 Contentful]');
  });

  it('masks secret prompts', async () => {
    const { lastFrame, stdin } = renderScreen({ skip: { skipAgent: true } });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );
    await answer(stdin, 'y');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
    );
    await answer(stdin, 'space');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Environment ID'),
    );
    await answer(stdin, '');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('CMA token'),
    );
    stdin.write('secret');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('••••••'),
    );
    expect(frame).toContain('••••••');
    expect(frame).not.toContain('secret');
  });

  it('renders confirm prompts with the default hint', async () => {
    const { lastFrame } = renderScreen({ skip: { skipAgent: true } });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );

    expect(frame).toContain('Configure Contentful credentials? [Y/n]');
  });

  it('shows the final summary with completed, skipped, and failed actions', async () => {
    const { lastFrame, onComplete } = renderScreen({
      skip: { skipAgent: true, skipCredentials: true, skipOptional: true },
    });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    expect(frame).toContain('✓ Node.js 24+');
    expect(frame).toContain('✓ pnpm');
    expect(frame).toContain('✓ Install & build');
    expect(frame).toContain('– Coding agent — skipped');
    expect(frame).toContain('– Contentful credentials — skipped');
    expect(frame).toContain('– Preferences — skipped');
    expect(frame).toContain('✓ Setup complete. You can now run: experiences import');

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 0, restartRequired: false, runDoctor: false }),
    );
  });

  it('reports a failed required action and a non-zero exit code', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({
      dependencies: createDependencies({
        binaryExists: async () => false,
        run: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }),
      }),
      skip: { skipAgent: true, skipCredentials: true, skipOptional: true },
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install pnpm via npm?'),
    );
    await answer(stdin, '');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('required step'),
    );

    expect(frame).toContain('✗ pnpm — required');
    expect(frame).toContain('⚠ 1 required step incomplete.');
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
  });

  it('stops with a restart notice after installing a Node version manager', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({
      dependencies: createDependencies({ nodeVersion: '22.0.0', binaryExists: async () => false }),
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install nvm now?'),
    );
    await answer(stdin, 'y');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('shell restart'),
    );

    expect(frame).toContain('✗ Node.js 24+ — required');
    expect(frame).toContain('Node.js setup requires a shell restart. Re-run experiences setup afterwards.');
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 0, restartRequired: true, runDoctor: false }),
    );
  });

  it('stops without a restart flag when the Node version manager install is declined', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({
      dependencies: createDependencies({ nodeVersion: '22.0.0', binaryExists: async () => false }),
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install nvm now?'),
    );
    await answer(stdin, 'n');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('shell restart'),
    );

    expect(frame).toContain('✗ Node.js 24+ — required');
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 0, restartRequired: false, runDoctor: false }),
    );
  });

  it('offers experiences doctor after the summary when asked to', async () => {
    const { lastFrame, stdin, onComplete } = renderScreen({
      offerDoctor: true,
      skip: { skipAgent: true, skipCredentials: true, skipOptional: true },
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Run experiences doctor now'),
    );
    await answer(stdin, '');

    await waitForFrame(
      () => lastFrame(),
      (f) => !f.includes('Run experiences doctor now'),
    );

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ runDoctor: true, exitCode: 0 }));
  });

  it('submits a pasted value that arrives with its own newline in one chunk', async () => {
    const writeCredentials = vi.fn();
    const { lastFrame, stdin } = renderScreen({
      dependencies: createDependencies({ writeCredentials }),
      skip: { skipAgent: true, skipOptional: true },
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );
    stdin.write('y\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
    );
    stdin.write('demo-space\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Environment ID'),
    );
    stdin.write('\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('CMA token'),
    );
    stdin.write('CFPAT-pasted-token\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('API host'),
    );
    stdin.write('\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    expect(writeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'demo-space',
        environmentId: 'master',
        cmaToken: 'CFPAT-pasted-token',
      }),
    );
  });

  it('strips the bracketed-paste markers a terminal wraps a pasted token in', async () => {
    const writeCredentials = vi.fn();
    const { lastFrame, stdin } = renderScreen({
      dependencies: createDependencies({ writeCredentials }),
      skip: { skipAgent: true, skipOptional: true },
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );
    stdin.write('y\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
    );
    stdin.write('demo-space\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Environment ID'),
    );
    stdin.write('\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('CMA token'),
    );
    stdin.write('\x1b[200~CFPAT-bracketed\x1b[201~\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('API host'),
    );
    stdin.write('\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    expect(writeCredentials).toHaveBeenCalledWith(expect.objectContaining({ cmaToken: 'CFPAT-bracketed' }));
  });

  it('renders preferences as a toggleable checkbox list', async () => {
    const { lastFrame } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose preferences to configure'),
    );

    expect(frame).toContain('❯ ◯ AI auto-filter');
    expect(frame).toContain('◯ Disable terminal colors');
    expect(frame).toContain('Space to toggle');
    expect(frame).not.toContain('[all] Configure all');
    expect(frame).not.toContain('for example, 1,3 or all');
  });

  it('skips every preference when Enter is pressed with nothing checked', async () => {
    const { lastFrame, stdin } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose preferences to configure'),
    );
    stdin.write('\r');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );
    expect(frame).toContain('– Preferences — skipped');
  });

  it('toggles every preference on with a and off again', async () => {
    const { lastFrame, stdin } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose preferences to configure'),
    );
    stdin.write('a');
    const allOn = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('◉ Disable terminal colors'),
    );
    expect(allOn).toContain('◉ AI auto-filter');

    stdin.write('a');
    const allOff = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('◯ Disable terminal colors'),
    );
    expect(allOff).toContain('◯ AI auto-filter');
  });

  it('moves the highlight with the arrow keys', async () => {
    const { lastFrame, stdin } = renderScreen({ skip: { skipAgent: true, skipCredentials: true } });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('❯ ◯ AI auto-filter'),
    );
    stdin.write('\x1b[B');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('❯ ◯ Performance concurrency'),
    );
    expect(frame).toContain('❯ ◯ Performance concurrency');
  });

  it('records configured preferences in the summary', async () => {
    const writeCredentials = vi.fn();
    const { lastFrame, stdin } = renderScreen({
      dependencies: createDependencies({ writeCredentials }),
      skip: { skipAgent: true, skipCredentials: true },
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose preferences to configure'),
    );
    stdin.write(' ');
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('◉ AI auto-filter'),
    );
    stdin.write('\r');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Enable AI auto-filter'),
    );
    await answer(stdin, 'n');

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Summary'),
    );

    expect(frame).toContain('✓ Preferences');
    expect(writeCredentials).toHaveBeenCalledWith({ spaceId: '', environmentId: '', cmaToken: '', autoFilter: false });
  });
});
