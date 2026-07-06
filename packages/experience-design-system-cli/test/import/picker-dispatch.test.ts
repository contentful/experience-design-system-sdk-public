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

  it('calls replayRun with the picked run id on action=push when no pickerPushRun dep is provided', async () => {
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

  it('routes action=push through pickerPushRun when interactive is true (default)', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    const pickerPushRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection(
      { action: 'push', runId: '01HXYZ' },
      { host: 'api.contentful.com' },
      { modifyRun, replayRun, pickerPushRun },
    );
    expect(pickerPushRun).toHaveBeenCalledTimes(1);
    expect(pickerPushRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ', host: 'api.contentful.com' }),
    );
    expect(replayRun).not.toHaveBeenCalled();
    expect(modifyRun).not.toHaveBeenCalled();
  });

  it('routes action=push through replayRun when interactive is false (CLI flag / non-TTY)', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    const pickerPushRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection(
      { action: 'push', runId: '01HXYZ' },
      { host: 'api.contentful.com', interactive: false },
      { modifyRun, replayRun, pickerPushRun },
    );
    expect(replayRun).toHaveBeenCalledTimes(1);
    expect(replayRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ', interactive: false }),
    );
    expect(pickerPushRun).not.toHaveBeenCalled();
  });

  it('forwards force flag through pickerPushRun', async () => {
    const modifyRun = vi.fn().mockResolvedValue(undefined);
    const replayRun = vi.fn().mockResolvedValue(undefined);
    const pickerPushRun = vi.fn().mockResolvedValue(undefined);
    await dispatchPickerSelection(
      { action: 'push', runId: '01HXYZ' },
      { force: true },
      { modifyRun, replayRun, pickerPushRun },
    );
    expect(pickerPushRun).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
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
