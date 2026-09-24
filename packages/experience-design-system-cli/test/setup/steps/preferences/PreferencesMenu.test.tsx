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
  it('names every preference, and leaves the values to their screens', async () => {
    const { lastFrame } = renderStep();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );

    for (const label of ['AI auto-filter', 'Custom prompts', 'Debug logging', 'Usage analytics', 'Terminal colors']) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain('Done');
  });

  it('never reads the credentials file to draw the list', async () => {
    // The menu holding no copy of the stored settings is what keeps a row from
    // going stale after a change, so the read belongs to the screens alone.
    const { lastFrame } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );

    expect(store.read).not.toHaveBeenCalled();
  });

  it('opens the color preference and returns to the menu', async () => {
    const { lastFrame, stdin } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    await choose(stdin, lastFrame, 'Terminal colors', 8);

    const opened = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Turn colors off'),
    );
    expect(opened).not.toContain('already set');
    expect(opened).not.toContain('Every preference already has a working default');

    await acceptDefault(stdin);
    const back = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    expect(back).toContain('Terminal colors');
    expect(store.write).not.toHaveBeenCalled();
  });

  it('ticks the new value when a changed preference is reopened', async () => {
    // Reopening is what shows the current value now, so the screen has to read the
    // write back rather than the menu caching it.
    store.write.mockImplementation(async (next: Record<string, unknown>) => {
      store.read.mockResolvedValue(next);
    });
    const { lastFrame, stdin } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    // AI auto-filter leads the menu; opening it and taking the non-default row
    // turns filtering off.
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    await choose(stdin, lastFrame, 'Keep every component');

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    await acceptDefault(stdin);

    const reopened = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    expect(reopened).toMatch(/Keep every component ✓/);
  });

  it('reports completed when a preference changed', async () => {
    store.write.mockImplementation(async (next: Record<string, unknown>) => {
      store.read.mockResolvedValue(next);
    });
    const { lastFrame, stdin, onDone } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    await choose(stdin, lastFrame, 'Keep every component');
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    await choose(stdin, lastFrame, 'Done', 8);

    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('reports skipped when the operator opens a preference but changes nothing', async () => {
    const { lastFrame, stdin, onDone } = renderStep();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components irrelevant'),
    );
    await acceptDefault(stdin);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Every preference already has a working default'),
    );
    await choose(stdin, lastFrame, 'Done', 8);

    expect(onDone).toHaveBeenCalledWith('skipped');
  });
});
