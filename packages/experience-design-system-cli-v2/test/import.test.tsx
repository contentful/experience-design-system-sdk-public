import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportScreen } from '../src/tui/import/PageContainer.js';
import {
  EMPTY_CONFIGURATION,
  type DsiConfiguration,
} from '../src/tui/settings/contentful-configuration/config-store.js';

const ESC = '\u001B';

const readDsiConfiguration = vi.hoisted(() => vi.fn());

vi.mock('../src/tui/settings/contentful-configuration/config-store.js', async () => {
  const actual = await vi.importActual<typeof import('../src/tui/settings/contentful-configuration/config-store.js')>(
    '../src/tui/settings/contentful-configuration/config-store.js',
  );
  return { ...actual, readDsiConfiguration };
});

vi.mock('../src/tui/import/run-composite-import.js', () => ({
  runCompositeImport: vi.fn(() => new Promise(() => {})),
}));

beforeEach(() => {
  readDsiConfiguration.mockReset();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

function config(overrides: Partial<DsiConfiguration>): DsiConfiguration {
  return { ...EMPTY_CONFIGURATION, ...overrides };
}

describe('ImportScreen', () => {
  it('pre-fills the form from the saved v2 configuration', async () => {
    readDsiConfiguration.mockResolvedValue(
      config({
        space_id: 'space123',
        env_id: 'staging',
        cma_token: 'secret-token',
      }),
    );
    const { lastFrame } = render(<ImportScreen onDone={vi.fn()} />);
    await flush();

    const frame = plain(lastFrame());
    expect(frame).toContain('Space ID: space123');
    expect(frame).toContain('Environment ID: staging');
    expect(frame).toContain(`CMA Token: ${'•'.repeat('secret-token'.length)}`);
    expect(frame).not.toContain('secret-token');
  });

  it('falls back to a blank form with the master environment when nothing is saved', async () => {
    readDsiConfiguration.mockResolvedValue(config({}));
    const { lastFrame } = render(<ImportScreen onDone={vi.fn()} />);
    await flush();

    const frame = plain(lastFrame());
    expect(frame).toContain('Space ID: (empty)');
    expect(frame).toContain('Environment ID: master');
    expect(frame).toContain('CMA Token: (empty)');
  });

  it('keeps master as the environment when only some values are saved', async () => {
    readDsiConfiguration.mockResolvedValue(config({ space_id: 'space123' }));
    const { lastFrame } = render(<ImportScreen onDone={vi.fn()} />);
    await flush();

    const frame = plain(lastFrame());
    expect(frame).toContain('Space ID: space123');
    expect(frame).toContain('Environment ID: master');
  });
});
