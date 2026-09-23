import { render } from 'ink-testing-library';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';
import { acceptDefault, choose } from '../select-helpers.js';

const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const shell = vi.hoisted(() => ({
  binaryExists: vi.fn(),
  pathExists: vi.fn(),
  runSpawn: vi.fn(),
  REQUIRED_NODE_MAJOR: 24,
}));

vi.mock('../../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

vi.mock('../../../../src/setup/lib/shell.js', () => shell);

const { PreferencesMenu } = await import('../../../../src/setup/steps/preferences/PreferencesMenu.js');

beforeEach(() => {
  store.read.mockReset().mockResolvedValue({ spaceId: '', environmentId: '', cmaToken: '' });
  store.write.mockReset().mockResolvedValue(undefined);
});

function renderStep(): ReturnType<typeof render> & { onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn();
  const result = render(<PreferencesMenu onDone={onDone} />);
  return { ...result, onDone };
}

describe('PreferencesMenu', () => {
  it('shows each preference with its current value', async () => {
    const { lastFrame } = renderStep();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );

    expect(frame).toContain('filtering out irrelevant components');
    expect(frame).toContain('quiet');
    expect(frame).toContain('sharing usage data');
    expect(frame).toContain('colors on');
  });

  it('reads each row as a name followed by its current value', async () => {
    const { lastFrame } = renderStep();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    expect(frame).toMatch(/Debug logging — quiet/);
    expect(frame).toMatch(/Terminal colors — colors on/);
  });

  it('opens the color preference and returns to the menu', async () => {
    const { lastFrame, stdin } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await choose(stdin, lastFrame, 'Terminal colors', 8);

    const opened = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Turn colors off'),
    );
    expect(opened).not.toContain('already set');
    expect(opened).not.toContain('Preferences — open one');

    await acceptDefault(stdin);
    const back = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    expect(back).toContain('Terminal colors');
    expect(store.write).not.toHaveBeenCalled();
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
    expect(back).toContain('keeping every component');
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
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preferences — open one'),
    );
    await choose(stdin, lastFrame, 'Done', 8);

    expect(onDone).toHaveBeenCalledWith('skipped');
  });
});
