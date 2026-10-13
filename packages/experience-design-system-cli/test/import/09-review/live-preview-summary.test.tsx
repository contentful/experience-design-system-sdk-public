import React from 'react';
import { render as inkRender } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { LivePreviewSummary } from '../../../src/tui/import/steps/09-review/components/LivePreviewSummary.js';
import type { PreviewAnnotation } from '../../../src/tui/import/steps/09-review/types.js';

const frame = (element: React.ReactElement): string =>
  (inkRender(element).lastFrame() ?? '').replace(/\u001b\[[0-9;]*m/g, '');

const annotations = (entries: Array<[string, PreviewAnnotation]>): Map<string, PreviewAnnotation> => new Map(entries);

const base = {
  enabled: true,
  previewAnnotations: annotations([]),
  status: 'idle' as const,
  disabled: false,
  spinner: '⠋',
};

describe('LivePreviewSummary', () => {
  it('shows nothing when live preview is off, whatever else is going on', () => {
    expect(frame(<LivePreviewSummary {...base} enabled={false} status="running" disabled />)).toBe('');
  });

  it('says the preview is disabled when the credentials were rejected', () => {
    expect(frame(<LivePreviewSummary {...base} disabled />)).toBe('Preview: disabled (creds rejected)');
  });

  it('prefers the disabled message over counts it already has', () => {
    const out = frame(<LivePreviewSummary {...base} disabled previewAnnotations={annotations([['A', 'new']])} />);

    expect(out).toBe('Preview: disabled (creds rejected)');
  });

  it('shows the spinner while the first preview is running and there is nothing to count yet', () => {
    expect(frame(<LivePreviewSummary {...base} status="running" spinner="⠙" />)).toBe('Preview: ⠙ running...');
  });

  it('keeps showing the last counts while a new preview runs, instead of flashing back to the spinner', () => {
    const out = frame(
      <LivePreviewSummary {...base} status="running" previewAnnotations={annotations([['A', 'new']])} />,
    );

    expect(out).toContain('1 new');
    expect(out).not.toContain('running');
  });

  it('shows nothing when idle with nothing to count', () => {
    expect(frame(<LivePreviewSummary {...base} />)).toBe('');
  });

  it('counts each kind of change', () => {
    const out = frame(
      <LivePreviewSummary
        {...base}
        previewAnnotations={annotations([
          ['A', 'new'],
          ['B', 'new'],
          ['C', 'changed'],
          ['D', 'removed'],
          ['E', 'breaking'],
          ['F', 'breaking'],
          ['G', 'breaking'],
        ])}
      />,
    );

    expect(out).toBe('Preview: 2 new · 1 changed · 1 removed · 3 breaking');
  });

  describe('the hint for the removed list', () => {
    const withRemoved = annotations([['A', 'removed']]);

    it('shows when asked to and something was removed', () => {
      const out = frame(
        <LivePreviewSummary {...base} previewAnnotations={withRemoved} removedCount={2} showRemovedListHint />,
      );

      expect(out).toContain('1 removed ([d] removed list)');
    });

    it('is left out when not asked for', () => {
      expect(frame(<LivePreviewSummary {...base} previewAnnotations={withRemoved} removedCount={2} />)).not.toContain(
        '[d]',
      );
    });

    it('is left out when the server removed nothing, even if asked for', () => {
      const out = frame(
        <LivePreviewSummary {...base} previewAnnotations={withRemoved} removedCount={0} showRemovedListHint />,
      );

      expect(out).not.toContain('[d]');
    });
  });
});
