import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { CredentialsStep } from '../../../src/import/tui/steps/CredentialsStep.js';

/**
 * Change 1 in the prefetch spec: there is no longer a dedicated
 * `validating-credentials` render screen. While the wizard pings the
 * management API, the credentials screen stays mounted with an inline
 * "Validating credentials..." status line, and its inputs are locked.
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
  };
}

describe('CredentialsStep — inline validation status', () => {
  it('shows "Validating credentials..." inline when validating prop is true', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep initialSpaceId="s" initialEnvironmentId="master" initialCmaToken="t" validating {...handlers} />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Validating credentials'),
      3000,
    );
    expect(frame).toContain('Validating credentials');
  });

  it('locks form submission and field edits while validating', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep initialSpaceId="s" initialEnvironmentId="master" initialCmaToken="t" validating {...handlers} />,
    );
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );
    // Submit attempt — should be ignored while validating.
    stdin.write('\r');
    stdin.write('\r');
    stdin.write('\r');
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 150));
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(handlers.onContinue).not.toHaveBeenCalled();
    // Typing should not mutate visible values either.
    stdin.write('xyz');
    await new Promise((r) => setTimeout(r, 100));
    expect(lastFrame()!).not.toContain('sxyz');
  });

  it('returns to editable form with an error when validation fails (error prop set, validating false)', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        error="Invalid CMA token"
        {...handlers}
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Invalid CMA token'),
      3000,
    );
    expect(frame).toContain('Invalid CMA token');
    expect(frame).not.toContain('Validating credentials');
  });
});
