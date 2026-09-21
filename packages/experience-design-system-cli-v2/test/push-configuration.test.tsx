import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationScreen } from '../src/tui/settings/push-configuration/screen.js';
import type { DsiConfiguration } from '../src/tui/settings/push-configuration/config-store.js';

const ESC = '\u001B';
const ARROW_DOWN = `${ESC}[B`;
const ENTER = '\r';

const EMPTY: DsiConfiguration = { space_id: '', env_id: '', cma_token: '', api_endpoint: '' };

const readDsiConfiguration = vi.hoisted(() => vi.fn());
const writeDsiConfiguration = vi.hoisted(() => vi.fn());
const dsiConfigurationPath = vi.hoisted(() => vi.fn(() => '/fake/.contentful/config/dsi_configuration.json'));

vi.mock('../src/tui/settings/push-configuration/config-store.js', () => ({
  readDsiConfiguration,
  writeDsiConfiguration,
  dsiConfigurationPath,
}));

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function plain(frame: string): string {
  return frame.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

function renderConfig() {
  const onDone = vi.fn();
  const instance = render(<ConfigurationScreen onDone={onDone} />);
  return { ...instance, onDone };
}

beforeEach(() => {
  readDsiConfiguration.mockReset().mockResolvedValue({ ...EMPTY });
  writeDsiConfiguration.mockReset().mockResolvedValue(undefined);
  dsiConfigurationPath.mockClear();
});

describe('ConfigurationScreen', () => {
  it('loads existing configuration and renders masked cma_token', async () => {
    readDsiConfiguration.mockResolvedValue({
      space_id: 'abc123',
      env_id: 'master',
      cma_token: 'CFPAT-secret',
      api_endpoint: 'https://api.contentful.com',
    });
    const { lastFrame } = renderConfig();
    await flush();

    const frame = plain(lastFrame()!);
    expect(frame).toContain('Space ID: abc123');
    expect(frame).toContain('Environment ID: master');
    expect(frame).toContain('CMA Token: ••••••••••••');
    expect(frame).not.toContain('CFPAT-secret');
    expect(frame).toContain('API Endpoint: https://api.contentful.com');
  });

  it('edits a field with letters overlapping global commands without triggering them', async () => {
    const { stdin, lastFrame, onDone } = renderConfig();
    await flush();

    stdin.write(ENTER);
    await flush();
    stdin.write('sandbox-qSv');
    await flush();
    stdin.write(ENTER);
    await flush();

    const frame = plain(lastFrame()!);
    expect(frame).toContain('Space ID: sandbox-qSv');
    expect(writeDsiConfiguration).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('toggles cma_token reveal with v while focused', async () => {
    readDsiConfiguration.mockResolvedValue({ ...EMPTY, cma_token: 'CFPAT-secret' });
    const { stdin, lastFrame } = renderConfig();
    await flush();

    stdin.write(ARROW_DOWN);
    stdin.write(ARROW_DOWN);
    await flush();

    stdin.write('v');
    await flush();
    expect(plain(lastFrame()!)).toContain('CMA Token: CFPAT-secret');

    stdin.write('v');
    await flush();
    expect(plain(lastFrame()!)).toContain('CMA Token: ••••••••••••');
  });

  it('saves on s, stays on the screen, and shows a confirmation', async () => {
    const { stdin, lastFrame, onDone } = renderConfig();
    await flush();

    stdin.write(ENTER);
    await flush();
    stdin.write('abc123');
    await flush();
    stdin.write(ENTER);
    await flush();

    stdin.write('s');
    await flush();

    expect(writeDsiConfiguration).toHaveBeenCalledWith(expect.objectContaining({ space_id: 'abc123' }));
    expect(onDone).not.toHaveBeenCalled();
    expect(plain(lastFrame()!)).toContain('Saved');
  });

  it('saves and quits to start on S', async () => {
    const { stdin, onDone } = renderConfig();
    await flush();

    stdin.write(ENTER);
    await flush();
    stdin.write('abc123');
    await flush();
    stdin.write(ENTER);
    await flush();

    stdin.write('S');
    await flush();

    expect(writeDsiConfiguration).toHaveBeenCalledWith(expect.objectContaining({ space_id: 'abc123' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('discards unsaved edits silently on q', async () => {
    const { stdin, onDone } = renderConfig();
    await flush();

    stdin.write(ENTER);
    await flush();
    stdin.write('unsaved-value');
    stdin.write(ENTER);
    await flush();

    stdin.write('q');
    await flush();

    expect(writeDsiConfiguration).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
