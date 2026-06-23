import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

const SAMPLE_PREVIEW: ServerPreviewResponse = {
  components: { new: [], changed: [], removed: [], unchanged: [] },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
};

const runLivePreviewMock = vi.fn();

vi.mock('../../../src/import/tui/runLivePreview.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/import/tui/runLivePreview.js')>(
    '../../../src/import/tui/runLivePreview.js',
  );
  return {
    ...actual,
    runLivePreview: (...args: unknown[]) => runLivePreviewMock(...args),
  };
});

beforeEach(() => {
  runLivePreviewMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const baseOpts = {
  enabled: true,
  sessionId: 'sess-1',
  tokensPath: '',
  spaceId: 'sp',
  environmentId: 'master',
  cmaToken: 't',
  host: 'h',
};

type HarnessProps = {
  enabled?: boolean;
  cmaToken?: string;
  onResult?: (response: ServerPreviewResponse | null) => void;
  onMount?: (api: { trigger: () => void }) => void;
  exposeStatus?: (s: { status: string; disabled: boolean }) => void;
};

let useLivePreview: typeof import('../../../src/import/tui/useLivePreview.js').useLivePreview;

function Harness(props: HarnessProps): React.ReactElement {
  const hook = useLivePreview({
    ...baseOpts,
    enabled: props.enabled ?? true,
    cmaToken: props.cmaToken ?? 't',
    onResult: props.onResult ?? (() => {}),
  });
  React.useEffect(() => {
    props.onMount?.({ trigger: hook.trigger });
  }, []);
  React.useEffect(() => {
    props.exposeStatus?.({ status: hook.status, disabled: hook.disabled });
  });
  return <Text>{`status=${hook.status} disabled=${String(hook.disabled)}`}</Text>;
}

beforeEach(async () => {
  const mod = await import('../../../src/import/tui/useLivePreview.js');
  useLivePreview = mod.useLivePreview;
});

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

describe('useLivePreview', () => {
  it('debounces a single trigger call to one runLivePreview call after 500ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runLivePreviewMock.mockResolvedValue({ generation: 1, response: SAMPLE_PREVIEW });

    let api: { trigger: () => void } | null = null;
    render(<Harness onMount={(a) => (api = a)} />);
    await flush();
    api!.trigger();
    expect(runLivePreviewMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(runLivePreviewMock).toHaveBeenCalledTimes(1);
  });

  it('collapses three rapid triggers within 500ms into a single call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runLivePreviewMock.mockResolvedValue({ generation: 1, response: SAMPLE_PREVIEW });

    let api: { trigger: () => void } | null = null;
    render(<Harness onMount={(a) => (api = a)} />);
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(100);
    api!.trigger();
    await vi.advanceTimersByTimeAsync(100);
    api!.trigger();
    await vi.advanceTimersByTimeAsync(500);
    expect(runLivePreviewMock).toHaveBeenCalledTimes(1);
  });

  it('two triggers > 500ms apart fire two calls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runLivePreviewMock.mockResolvedValue({ generation: 1, response: SAMPLE_PREVIEW });

    let api: { trigger: () => void } | null = null;
    render(<Harness onMount={(a) => (api = a)} />);
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(600);
    api!.trigger();
    await vi.advanceTimersByTimeAsync(600);
    expect(runLivePreviewMock).toHaveBeenCalledTimes(2);
  });

  it('with enabled: false, trigger is a no-op', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let api: { trigger: () => void } | null = null;
    render(<Harness enabled={false} onMount={(a) => (api = a)} />);
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runLivePreviewMock).not.toHaveBeenCalled();
  });

  it('with cmaToken empty, trigger is a no-op', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let api: { trigger: () => void } | null = null;
    render(<Harness cmaToken="" onMount={(a) => (api = a)} />);
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runLivePreviewMock).not.toHaveBeenCalled();
  });

  it('discards stale generation responses (N completes after N+1 fires)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveFirst: ((v: { generation: number; response: ServerPreviewResponse }) => void) | null = null;
    const firstPending = new Promise<{ generation: number; response: ServerPreviewResponse }>((r) => {
      resolveFirst = r;
    });
    runLivePreviewMock.mockImplementationOnce(() => firstPending);
    runLivePreviewMock.mockResolvedValueOnce({ generation: 2, response: SAMPLE_PREVIEW });

    const onResult = vi.fn();
    let api: { trigger: () => void } | null = null;
    render(<Harness onMount={(a) => (api = a)} onResult={onResult} />);
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(500);
    // first call is in-flight
    api!.trigger();
    await vi.advanceTimersByTimeAsync(500);
    // second call is in-flight; resolve first call AFTER second
    // resolve second first
    await flush();
    // now resolve first (stale)
    resolveFirst!({ generation: 1, response: { ...SAMPLE_PREVIEW } });
    await flush();
    await flush();
    // onResult should have been called only once (with second response)
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(SAMPLE_PREVIEW);
  });

  it('sets disabled on 401 ApiError and subsequent triggers no-op; emits stderr', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { ApiError } = await import('../../../src/apply/api-client.js');
    runLivePreviewMock.mockRejectedValueOnce(new ApiError('preview failed: 401', 401, ''));

    let api: { trigger: () => void } | null = null;
    let lastStatus: { status: string; disabled: boolean } | null = null;
    render(
      <Harness
        onMount={(a) => (api = a)}
        exposeStatus={(s) => {
          lastStatus = s;
        }}
      />,
    );
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    await flush();
    expect(lastStatus?.disabled).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();
    const stderrCall = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrCall).toMatch(/live-preview/);

    // subsequent trigger should be a no-op
    runLivePreviewMock.mockClear();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runLivePreviewMock).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('on non-401 error: logs to stderr but does not disable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    runLivePreviewMock.mockRejectedValueOnce(new Error('network down'));

    let api: { trigger: () => void } | null = null;
    let lastStatus: { status: string; disabled: boolean } | null = null;
    render(
      <Harness
        onMount={(a) => (api = a)}
        exposeStatus={(s) => {
          lastStatus = s;
        }}
      />,
    );
    await flush();
    api!.trigger();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    await flush();
    expect(lastStatus?.disabled).toBe(false);
    const stderrCall = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrCall).toMatch(/live-preview/);
    stderrSpy.mockRestore();
  });

  it('cycles status idle → running → idle on success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveFn: ((v: { generation: number; response: ServerPreviewResponse }) => void) | null = null;
    runLivePreviewMock.mockImplementationOnce(
      () =>
        new Promise<{ generation: number; response: ServerPreviewResponse }>((r) => {
          resolveFn = r;
        }),
    );

    const statuses: string[] = [];
    let api: { trigger: () => void } | null = null;
    render(
      <Harness
        onMount={(a) => (api = a)}
        exposeStatus={(s) => {
          statuses.push(s.status);
        }}
      />,
    );
    await flush();
    expect(statuses[statuses.length - 1]).toBe('idle');
    api!.trigger();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(statuses).toContain('running');
    resolveFn!({ generation: 1, response: SAMPLE_PREVIEW });
    await flush();
    await flush();
    expect(statuses[statuses.length - 1]).toBe('idle');
  });
});
