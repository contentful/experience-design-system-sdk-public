import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ServerPreviewView } from '../../../src/apply/tui/ServerPreviewView.js';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

function previewWithRemoved(): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], unchanged: [], removed: [{ name: 'OrphanedCard' }] },
    tokens: { new: [], changed: [], unchanged: [], removed: [{ name: 'orphaned-token' }] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
  } as unknown as ServerPreviewResponse;
}

describe('ServerPreviewView — skip vs delete rendering', () => {
  it('renders removed entities as "to skip" when allowDeletions is false', () => {
    const { lastFrame } = render(
      <ServerPreviewView
        preview={previewWithRemoved()}
        spaceId="space"
        environmentId="master"
        allowDeletions={false}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('to skip');
    expect(frame).not.toContain('to delete');
  });

  it('renders removed entities as "to delete" when allowDeletions is true', () => {
    const { lastFrame } = render(
      <ServerPreviewView preview={previewWithRemoved()} spaceId="space" environmentId="master" allowDeletions={true} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('to delete');
    expect(frame).not.toContain('to skip');
  });

  it('renders the hidden-deletions hint when allowDeletions is false', () => {
    const preview = {
      components: { new: [], changed: [], unchanged: [], removed: [] },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    } as unknown as ServerPreviewResponse;
    const { lastFrame } = render(
      <ServerPreviewView preview={preview} spaceId="space" environmentId="master" allowDeletions={false} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Deletions are hidden by default');
  });

  it('does not render the hidden-deletions hint when allowDeletions is true', () => {
    const preview = {
      components: { new: [], changed: [], unchanged: [], removed: [] },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    } as unknown as ServerPreviewResponse;
    const { lastFrame } = render(
      <ServerPreviewView preview={preview} spaceId="space" environmentId="master" allowDeletions={true} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Deletions are hidden by default');
  });
});
