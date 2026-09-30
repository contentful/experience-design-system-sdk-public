import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportScreen } from '../../src/tui/import/PageContainer.js';

const ESC = '\u001B';

const spawnV1Import = vi.hoisted(() => vi.fn());

vi.mock('../../src/tui/import/spawn-v1-import.js', () => ({ spawnV1Import }));

beforeEach(() => {
  spawnV1Import.mockReset();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

describe('ImportScreen', () => {
  it('goes straight back to the menu when the v1 wizard exits cleanly, for example when the user quits', async () => {
    spawnV1Import.mockResolvedValue({ exitCode: 0, result: undefined, stdout: '', stderr: '' });
    const onDone = vi.fn();
    const { lastFrame } = render(<ImportScreen onDone={onDone} />);
    await flush();

    expect(onDone).toHaveBeenCalledOnce();
    expect(plain(lastFrame())).not.toContain('Import failed');
  });

  it('shows a failure with the exit code when the v1 wizard exits with an error', async () => {
    spawnV1Import.mockResolvedValue({ exitCode: 1, result: undefined, stdout: '', stderr: '' });
    const onDone = vi.fn();
    const { lastFrame } = render(<ImportScreen onDone={onDone} />);
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain('Import failed: Import process exited with code 1');
  });

  it('shows a failure when the v1 wizard cannot be started', async () => {
    spawnV1Import.mockRejectedValue(new Error('spawn node ENOENT'));
    const onDone = vi.fn();
    const { lastFrame } = render(<ImportScreen onDone={onDone} />);
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain('Import failed: spawn node ENOENT');
  });
});
