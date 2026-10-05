import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

const runLivePreviewMock = vi.fn();
vi.mock('../../../src/import/tui/runLivePreview.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/import/tui/runLivePreview.js')>(
    '../../../src/import/tui/runLivePreview.js',
  );
  return { ...actual, runLivePreview: (...args: unknown[]) => runLivePreviewMock(...args) };
});

const previewWithRemoved = (names: string[]): ServerPreviewResponse => ({
  components: {
    new: [],
    changed: [],
    removed: names.map((n, i) => ({ id: `id-${i}`, name: n, contentProperties: [], designProperties: [], slots: [] })),
    unchanged: [],
  },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
  taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
});

let useFinalizePreview: typeof import('../../../src/import/tui/useFinalizePreview.js').useFinalizePreview;

type HarnessProps = {
  open: boolean;
  cmaToken?: string;
  acceptedKeys?: Set<string>;
  expose?: (api: { status: string; removedCount: number; scrollOffset: number; scrollBy: (d: number) => void }) => void;
};

function Harness(props: HarnessProps): React.ReactElement {
  const hook = useFinalizePreview({
    open: props.open,
    extractSessionId: 'sess-1',
    tokensPath: '',
    spaceId: 'sp',
    environmentId: 'master',
    cmaToken: props.cmaToken ?? 't',
    host: 'h',
    acceptedKeys: props.acceptedKeys ?? new Set(['Button']),
  });
  React.useEffect(() => {
    props.expose?.({
      status: hook.status,
      removedCount: hook.removed.length,
      scrollOffset: hook.scrollOffset,
      scrollBy: hook.scrollBy,
    });
  });
  return <Text>{`status=${hook.status} removed=${hook.removed.length} off=${hook.scrollOffset}`}</Text>;
}

beforeEach(async () => {
  runLivePreviewMock.mockReset();
  const mod = await import('../../../src/import/tui/useFinalizePreview.js');
  useFinalizePreview = mod.useFinalizePreview;
});

afterEach(() => {
  vi.clearAllMocks();
});

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

describe('useFinalizePreview', () => {
  it('is idle when closed and fires a scoped preview when opened', async () => {
    runLivePreviewMock.mockResolvedValue({ generation: 1, response: previewWithRemoved(['Old']) });
    const { rerender, lastFrame } = render(<Harness open={false} />);
    expect(lastFrame()).toMatch(/status=idle/);
    expect(runLivePreviewMock).not.toHaveBeenCalled();

    rerender(<Harness open acceptedKeys={new Set(['Button', 'Card'])} />);
    await flush();
    expect(runLivePreviewMock).toHaveBeenCalledTimes(1);
    const arg = runLivePreviewMock.mock.calls[0][0];
    expect([...arg.acceptedKeys].sort()).toEqual(['Button', 'Card']);
    expect(lastFrame()).toMatch(/status=done removed=1/);
  });

  it('passes deleteAllComponents when the accepted set is empty', async () => {
    runLivePreviewMock.mockResolvedValue({ generation: 1, response: previewWithRemoved(['A', 'B']) });
    render(<Harness open acceptedKeys={new Set()} />);
    await flush();
    expect(runLivePreviewMock.mock.calls[0][0].deleteAllComponents).toBe(true);
  });

  it('short-circuits to done with no removed list when credentials are missing', async () => {
    const { lastFrame } = render(<Harness open cmaToken="" />);
    await flush();
    expect(runLivePreviewMock).not.toHaveBeenCalled();
    expect(lastFrame()).toMatch(/status=done removed=0/);
  });

  it('reports error status when the preview throws', async () => {
    runLivePreviewMock.mockRejectedValue(new Error('boom'));
    const { lastFrame } = render(<Harness open />);
    await flush();
    expect(lastFrame()).toMatch(/status=error/);
  });

  it('scrollBy clamps within the removed window', async () => {
    runLivePreviewMock.mockResolvedValue({
      generation: 1,
      response: previewWithRemoved(Array.from({ length: 10 }, (_, i) => `C${i}`)),
    });
    let api: { scrollOffset: number; scrollBy: (d: number) => void } | undefined;
    render(<Harness open expose={(a) => (api = a)} />);
    await flush();
    // 10 removed, window 6 → max offset 4.
    api!.scrollBy(100);
    await flush();
    expect(api!.scrollOffset).toBe(4);
    api!.scrollBy(-100);
    await flush();
    expect(api!.scrollOffset).toBe(0);
  });
});
