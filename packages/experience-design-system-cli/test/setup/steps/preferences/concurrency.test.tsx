import { render } from 'ink-testing-library';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ExperiencesCredentials } from '../../../../src/credentials-store.js';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';
import { acceptDefault, choose } from '../select-helpers.js';

const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const shell = vi.hoisted(() => ({ profileContains: vi.fn(), appendToProfile: vi.fn() }));

vi.mock('../../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

vi.mock('../../../../src/setup/lib/shell.js', () => shell);

const { ConcurrencyScreen } = await import('../../../../src/setup/steps/preferences/concurrency.js');

const EMPTY: ExperiencesCredentials = { spaceId: '', environmentId: '', cmaToken: '' };

beforeEach(() => {
  store.read.mockReset().mockResolvedValue(EMPTY);
  store.write.mockReset().mockResolvedValue(undefined);
  shell.profileContains.mockReset().mockResolvedValue(false);
  shell.appendToProfile.mockReset().mockResolvedValue(undefined);
});

function setup(stored: ExperiencesCredentials = EMPTY) {
  store.read.mockResolvedValue(stored);
  const onDone = vi.fn();
  return { ...render(<ConcurrencyScreen onDone={onDone} />), onDone };
}

describe('ConcurrencyScreen', () => {
  it('stores the choice in the credentials file, never the shell profile', async () => {
    const { lastFrame, stdin, onDone } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );
    await choose(stdin, lastFrame, 'Extract 8 files at once');

    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ extractConcurrency: 8 }));
    // A profile export would not reach a Windows shell, so nothing is appended.
    expect(shell.appendToProfile).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('writes nothing when the operator keeps the per-core default', async () => {
    const { lastFrame, stdin, onDone } = setup();
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );
    await acceptDefault(stdin);

    expect(store.write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('opens with the stored value leading the list, so Enter keeps it', async () => {
    const { lastFrame, stdin, onDone } = setup({ ...EMPTY, extractConcurrency: 4 });
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );

    expect(frame).toContain('Keep 4 files at once');
    await acceptDefault(stdin);

    expect(store.write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('clears the stored value when the operator returns to the per-core default', async () => {
    const { lastFrame, stdin, onDone } = setup({ ...EMPTY, extractConcurrency: 4 });
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );
    await choose(stdin, lastFrame, 'One per CPU core');

    const saved = store.write.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('extractConcurrency');
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('names the effect rather than the environment variable', async () => {
    const { lastFrame } = setup();
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );

    expect(frame).not.toContain('EDS_EXTRACT_CONCURRENCY');
    expect(frame).not.toContain('.zshrc');
  });
});
