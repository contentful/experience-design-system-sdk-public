import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { DoneStep } from '../../../../src/import/tui/steps/DoneStep.js';

const ZERO = { created: 0, updated: 0, removed: 0, failed: 0 };

describe('DoneStep', () => {
  it('renders the canonical Contentful URL on a successful push', () => {
    const { lastFrame } = render(
      <DoneStep
        componentTypes={{ created: 2, updated: 1, removed: 0, failed: 0 }}
        designTokens={ZERO}
        spaceId="my-space"
        environmentId="master"
        onExit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain(
      'https://app.contentful.com/spaces/my-space/environments/master/views/components',
    );
    expect(out).not.toContain('/exo/components');
  });

  it('omits the URL when nothing was pushed', () => {
    const { lastFrame } = render(
      <DoneStep
        componentTypes={ZERO}
        designTokens={ZERO}
        spaceId="my-space"
        environmentId="master"
        onExit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('app.contentful.com');
  });

  it('renders removed counts for component types and design tokens when non-zero', () => {
    const { lastFrame } = render(
      <DoneStep
        componentTypes={{ created: 0, updated: 0, removed: 2, failed: 0 }}
        designTokens={{ created: 0, updated: 0, removed: 3, failed: 0 }}
        spaceId="my-space"
        environmentId="master"
        onExit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('2 Component Types removed');
    expect(out).toContain('3 Design Tokens removed');
  });

  it('omits the removed line when removed is zero', () => {
    const { lastFrame } = render(
      <DoneStep
        componentTypes={{ created: 1, updated: 0, removed: 0, failed: 0 }}
        designTokens={ZERO}
        spaceId="my-space"
        environmentId="master"
        onExit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('removed');
  });
});
