import { render } from 'ink-testing-library';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';
import { acceptDefault, choose } from '../select-helpers.js';

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

vi.mock('../../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

vi.mock('../../../../src/setup/lib/shell.js', () => shell);

const { PreferencesStep } = await import('../../../../src/setup/steps/preferences/PreferencesStep.js');

beforeEach(() => {
  store.read.mockReset().mockResolvedValue({ spaceId: '', environmentId: '', cmaToken: '' });
  store.write.mockReset().mockResolvedValue(undefined);
  shell.profileContains.mockReset().mockResolvedValue(false);
  shell.appendToProfile.mockReset().mockResolvedValue(undefined);
});

function renderStep(): ReturnType<typeof render> & { onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn();
  const result = render(<PreferencesStep profilePath="/home/tester/.zshrc" onDone={onDone} />);
  return { ...result, onDone };
}

describe('PreferencesStep', () => {
  it('shows each preference with its current value', async () => {
    const { lastFrame } = renderStep();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );

    expect(frame).toContain('Filtering irrelevant components');
    expect(frame).toContain('Quiet');
    expect(frame).toContain('Sharing usage data');
    expect(frame).toContain('Colors on');
  });

  it('separates each preference name from its current value', async () => {
    const { lastFrame } = renderStep();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );

    // The value column is padded clear of the longest name, so shorter names get
    // a wider gap rather than sitting against their value.
    expect(frame).toMatch(/Debug logging {8,}Quiet/);
    expect(frame).toMatch(/Terminal colors {6,}Colors on/);
  });

  it('opens a profile preference whose variable is already set', async () => {
    // Regression: the screen used to report back the moment it saw the variable,
    // which bounced the operator to the menu and looked like the row would not open.
    // NO_COLOR is the remaining profile-backed preference.
    shell.profileContains.mockResolvedValue(true);
    const { lastFrame, stdin } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await choose(stdin, lastFrame, 'Terminal colors', 8);

    const opened = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('already set'),
    );
    expect(opened).toContain('NO_COLOR is already set');
    expect(opened).not.toContain('Preferences — open one');

    // And Back returns to the menu.
    await acceptDefault(stdin);
    const back = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    expect(back).toContain('Terminal colors');
  });

  it('reflects a changed preference in the menu row after returning', async () => {
    // The screen writes through to the store, so the menu's re-read must see the
    // new value rather than the one it first loaded.
    store.write.mockImplementation(async (next: Record<string, unknown>) => {
      store.read.mockResolvedValue(next);
    });
    const { lastFrame, stdin } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    // AI auto-filter leads the menu; opening it and taking the non-default row
    // turns filtering off.
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    await choose(stdin, lastFrame, 'Keep every component');

    const back = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    expect(back).toContain('Keeping every component');
  });

  it('reports completed when a preference changed', async () => {
    store.write.mockImplementation(async (next: Record<string, unknown>) => {
      store.read.mockResolvedValue(next);
    });
    const { lastFrame, stdin, onDone } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    await choose(stdin, lastFrame, 'Keep every component');
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await choose(stdin, lastFrame, 'Done', 8);

    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('reports skipped when the operator opens a preference but changes nothing', async () => {
    const { lastFrame, stdin, onDone } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    // Accepting the highlighted row keeps the current setting, which the screen
    // reports as skipped.
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await choose(stdin, lastFrame, 'Done', 8);

    expect(onDone).toHaveBeenCalledWith('skipped');
  });
});
