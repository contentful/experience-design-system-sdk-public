import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { CredentialsStep } from '../../../src/import/tui/steps/CredentialsStep.js';

/**
 * Skip-credentials spec: an operator who wants to walk the wizard without
 * pushing (or whose creds just failed validation) can press `s` to advance
 * without validating credentials. Push is disabled downstream.
 *
 * This file pins the CredentialsStep-level contract: the legend hint is
 * always rendered, the `s` keybind fires `onSkip`, and `s` is gated against
 * text-entry mode (typing into a form field must not trigger a skip).
 */

const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

afterEach(() => {
  mockExit.mockClear();
  vi.clearAllMocks();
});

function makeHandlers() {
  return {
    onConfirm: vi.fn(),
    onContinue: vi.fn(),
    onQuit: vi.fn(),
    onSkip: vi.fn(),
  };
}

describe('CredentialsStep — skip option', () => {
  it('renders the [s] Skip legend hint on the initial credentials screen', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[s]') && f.includes('Skip'),
      3000,
    );
    expect(frame).toContain('[s]');
    expect(frame).toContain('Skip');
    expect(frame).toContain('review locally only');
  });

  it('renders the [s] Skip legend hint after a credential validation failure', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        error="Unauthorized (401)"
        {...handlers}
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Unauthorized') && f.includes('[s]'),
      3000,
    );
    expect(frame).toContain('Unauthorized');
    expect(frame).toContain('[s]');
    expect(frame).toContain('Skip');
  });

  it('pressing s with empty form (no text-entry in flight) fires onSkip', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('[s]'),
      3000,
    );
    stdin.write('s');
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(handlers.onContinue).not.toHaveBeenCalled();
  });

  it('typing s into the Space ID field treats it as input and does NOT fire onSkip', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );
    // Type a non-skip character first so the field is "being typed into".
    stdin.write('a');
    stdin.write('s');
    expect(handlers.onSkip).not.toHaveBeenCalled();
    // 'as' should appear in the Space ID field.
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Space ID:.*as/);
  });

  it('does NOT fire onSkip while validating prop is true (input locked)', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(
      <CredentialsStep initialSpaceId="s" initialEnvironmentId="master" initialCmaToken="t" validating {...handlers} />,
    );
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Validating credentials'),
      3000,
    );
    stdin.write('s');
    expect(handlers.onSkip).not.toHaveBeenCalled();
  });
});
