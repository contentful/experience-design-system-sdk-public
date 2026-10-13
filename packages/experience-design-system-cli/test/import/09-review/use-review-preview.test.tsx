import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

const trigger = vi.fn();
let status: 'idle' | 'running' = 'idle';
let capturedOnResult: ((response: ServerPreviewResponse | null) => void) | undefined;
let capturedOptions: Record<string, unknown> | undefined;

vi.mock('../../../src/tui/import/steps/09-review/use-live-preview.js', () => ({
  useLivePreview: (options: Record<string, unknown>) => {
    capturedOptions = options;
    capturedOnResult = options['onResult'] as typeof capturedOnResult;
    return { trigger, status, disabled: false };
  },
}));

const { useReviewPreview } = await import('../../../src/tui/import/steps/09-review/use-review-preview.js');
type Result = ReturnType<typeof useReviewPreview>;

const response = (overrides: Partial<ServerPreviewResponse['components']> = {}): ServerPreviewResponse => ({
  components: { new: [], changed: [], removed: [], unchanged: [], ...overrides },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
  taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// Probes are unmounted after each test: a mounted one keeps its effects, and the mocks below are shared.
const mounted: Array<() => void> = [];

function mount(overrides: Partial<Parameters<typeof useReviewPreview>[0]> = {}) {
  const ref: { current: Result | null } = { current: null };
  const onResult = vi.fn();
  function Probe(): React.ReactElement {
    ref.current = useReviewPreview({
      components: [{ key: 'Button' }, { key: 'Card' }],
      loading: false,
      livePreview: true,
      sessionId: 'sess-1',
      tokensPath: '/t.json',
      spaceId: 'sp',
      environmentId: 'master',
      cmaToken: 'token',
      host: 'h',
      onResult,
      ...overrides,
    });
    return <Text>-</Text>;
  }
  mounted.push(render(<Probe />).unmount);
  return { result: () => ref.current!, onResult };
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

beforeEach(() => {
  trigger.mockReset();
  status = 'idle';
  capturedOnResult = undefined;
  capturedOptions = undefined;
});

describe('useReviewPreview', () => {
  it('hands the live preview its credentials, session and whether it is on', () => {
    mount();

    expect(capturedOptions).toMatchObject({
      enabled: true,
      sessionId: 'sess-1',
      tokensPath: '/t.json',
      spaceId: 'sp',
      environmentId: 'master',
      cmaToken: 'token',
      host: 'h',
    });
  });

  it('starts with no annotations and nothing removed', () => {
    const { result } = mount();

    expect(result().previewAnnotations.size).toBe(0);
    expect(result().removedComponents).toEqual([]);
  });

  describe('when the preview first fires', () => {
    it('triggers once the review has loaded, with live preview on and something to preview', async () => {
      mount();
      await settle();

      expect(trigger).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the review is still loading', { loading: true }],
      ['live preview is off', { livePreview: false }],
      ['there are no components', { components: [] }],
    ])('does not trigger while %s', async (_label, overrides) => {
      mount(overrides);
      await settle();

      expect(trigger).not.toHaveBeenCalled();
    });
  });

  describe('when a result arrives', () => {
    it('annotates the components by name from what the server says', async () => {
      const { result } = mount();
      await settle();

      capturedOnResult!(
        response({ changed: [{ current: { name: 'Button' } } as never], removed: [{ name: 'Gone' } as never] }),
      );
      await settle();

      expect([...result().previewAnnotations]).toEqual(
        expect.arrayContaining([
          ['Button', 'changed'],
          ['Gone', 'removed'],
          ['Card', 'new'],
        ]),
      );
    });

    it('keeps the components the server says were removed, so the list can show them', async () => {
      const { result } = mount();
      await settle();

      capturedOnResult!(response({ removed: [{ name: 'Gone' } as never] }));
      await settle();

      expect(result().removedComponents).toEqual([{ name: 'Gone' }]);
    });

    it('passes the response on to the caller', async () => {
      const { onResult } = mount();
      await settle();
      const server = response();

      capturedOnResult!(server);

      expect(onResult).toHaveBeenCalledWith(server);
    });

    it('ignores a null result, which is what a skipped preview returns', async () => {
      const { result, onResult } = mount();
      await settle();
      capturedOnResult!(response({ removed: [{ name: 'Gone' } as never] }));
      await settle();

      capturedOnResult!(null);
      await settle();

      expect(result().removedComponents).toEqual([{ name: 'Gone' }]);
      expect(onResult).toHaveBeenCalledTimes(1);
    });
  });

  describe('the spinner', () => {
    it('shows a braille frame', () => {
      expect(mount().result().livePreviewSpinner).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/);
    });

    it('animates while a preview is running', async () => {
      status = 'running';
      const { result } = mount();
      const first = result().livePreviewSpinner;

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(result().livePreviewSpinner).not.toBe(first);
    });

    it('stays still when idle', async () => {
      const { result } = mount();
      const first = result().livePreviewSpinner;

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(result().livePreviewSpinner).toBe(first);
    });
  });
});
