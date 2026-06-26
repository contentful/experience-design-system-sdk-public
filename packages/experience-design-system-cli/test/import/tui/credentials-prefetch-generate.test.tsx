import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { CredentialsStep } from '../../../src/import/tui/steps/CredentialsStep.js';

/**
 * Change 2 in the prefetch spec: while the operator types credentials, the
 * wizard runs `generate components` in the background. The credentials screen
 * renders an inline status reflecting the prefetch's current state. These
 * tests pin the prop-driven rendering — the subprocess wiring itself is
 * exercised by spawn-generate.test.ts and the wizard-flow integration tests.
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
    onRetryPrefetch: vi.fn(),
  };
}

describe('CredentialsStep — prefetch status banners', () => {
  it('shows "Component generation in progress..." while prefetch is running', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        generatePrefetchStatus="running"
        {...handlers}
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Component generation in progress'),
      3000,
    );
    expect(frame).toContain('Component generation in progress');
  });

  it('shows "Component generation complete." once prefetch finishes', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        generatePrefetchStatus="complete"
        {...handlers}
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Component generation complete'),
      3000,
    );
    expect(frame).toContain('Component generation complete');
  });

  it('shows a failure banner with the error when prefetch fails', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        generatePrefetchStatus="failed"
        generatePrefetchError="timed out talking to claude"
        {...handlers}
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Component generation failed'),
      3000,
    );
    expect(frame).toContain('Component generation failed');
    expect(frame).toContain('timed out talking to claude');
  });

  it('shows combined "Validating credentials & finishing component generation..." status while both are in flight', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        validating
        generatePrefetchStatus="running"
        {...handlers}
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Validating credentials & finishing component generation'),
      3000,
    );
    expect(frame).toContain('Validating credentials & finishing component generation');
  });

  it('R key invokes onRetryPrefetch when prefetch failed', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        generatePrefetchStatus="failed"
        generatePrefetchError="boom"
        {...handlers}
      />,
    );
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );
    stdin.write('R');
    await new Promise((r) => setTimeout(r, 100));
    expect(handlers.onRetryPrefetch).toHaveBeenCalledTimes(1);
  });
});
