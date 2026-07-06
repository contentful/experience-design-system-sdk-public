import { describe, expect, it, vi } from 'vitest';
import { dispatchPickerSelection } from '../../src/import/picker-dispatch.js';

// Regression test for a run-picker bug: after selecting a run in the wizard's
// initial picker, the CLI must actually invoke replayRun / modifyRun. Prior
// to this fix, command.ts called `setImmediate(() => process.exit(0))` inside
// the picker callback, which killed the process before the `await modifyRun`
// / `await replayRun` dispatch could run. The dispatch path was dead code.
//
// This test exercises the pure dispatch decision so a future regression that
// forgets to route into modifyRun/replayRun after the picker resolves would
// fail loudly. The Ink render + unmount is exercised via a smoke test.

describe('dispatchPickerSelection', () => {
  it('calls modifyRun with the picked run id on action=modify', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection(
      { action: 'modify', runId: '01HXYZ' },
      { outDir: undefined, overwrite: false, saveAsNew: false, force: false, host: undefined },
      { modifyRun, replayRun },
    );
    expect(modifyRun).toHaveBeenCalledTimes(1);
    expect(modifyRun).toHaveBeenCalledWith({ runIdOrPath: '01HXYZ' });
    expect(replayRun).not.toHaveBeenCalled();
  });

  it('calls replayRun with the picked run id on action=push', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection(
      { action: 'push', runId: '01HXYZ' },
      { host: 'api.contentful.com', force: false },
      { modifyRun, replayRun },
    );
    expect(replayRun).toHaveBeenCalledTimes(1);
    expect(replayRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ', host: 'api.contentful.com' }),
    );
    expect(modifyRun).not.toHaveBeenCalled();
  });

  it('forwards optional modify flags when set', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection(
      { action: 'modify', runId: '01HXYZ' },
      { outDir: '/tmp/out', overwrite: true, force: true },
      { modifyRun, replayRun },
    );
    expect(modifyRun).toHaveBeenCalledWith({
      runIdOrPath: '01HXYZ',
      outDir: '/tmp/out',
      overwrite: true,
      force: true,
    });
  });

  it('is a no-op when action is new (wizard already advanced past the picker)', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection({ action: 'new', runId: null }, {}, { modifyRun, replayRun });
    expect(modifyRun).not.toHaveBeenCalled();
    expect(replayRun).not.toHaveBeenCalled();
  });
});
