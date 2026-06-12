import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { PreviewValidationErrorStep } from '../../../src/import/tui/steps/PreviewValidationErrorStep.js';
import type { PreviewValidationError } from '../../../src/apply/api-client.js';

afterEach(() => {
  vi.clearAllMocks();
});

function makeHandlers() {
  return {
    onEdit: vi.fn(),
    onSkip: vi.fn(),
    onQuit: vi.fn(),
  };
}

const SLOT_ERROR: PreviewValidationError = {
  componentName: 'PageLink',
  path: 'manifest:components/PageLink/$slots/',
  message: 'Slot id must be a non-empty string',
};

const PROP_ERROR: PreviewValidationError = {
  componentName: 'Button',
  path: 'manifest:components/Button/$properties/variant',
  message: 'variant required',
};

describe('PreviewValidationErrorStep — rendering', () => {
  it('renders the failure header with red intent (no green ✓)', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(<PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={[]} {...handlers} />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preview validation failed'),
      3000,
    );

    expect(frame).toContain('Preview validation failed');
    expect(frame).toContain('✗');
    expect(frame).not.toContain('✓ Preview validation failed');
  });

  it('lists each error line with component name and message', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR, PROP_ERROR]} missingNames={[]} {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('PageLink') && f.includes('Button'),
      3000,
    );

    expect(frame).toContain('PageLink: Slot id must be a non-empty string');
    expect(frame).toContain('Button: variant required');
  });

  it('shows the singular component name in the skip label when only one component failed', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(<PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={[]} {...handlers} />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Skip PageLink'),
      3000,
    );

    expect(frame).toContain('Skip PageLink and retry');
  });

  it('shows the count in the skip label when multiple components failed', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR, PROP_ERROR]} missingNames={[]} {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Skip 2 components'),
      3000,
    );

    expect(frame).toContain('Skip 2 components and retry');
  });

  it('surfaces missingNames in the context note', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <PreviewValidationErrorStep
        errors={[SLOT_ERROR, { ...PROP_ERROR, componentName: 'Phantom' }]}
        missingNames={['Phantom']}
        {...handlers}
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Phantom'),
      3000,
    );

    expect(frame).toContain('Phantom');
    expect(frame).toContain('does not match anything');
  });

  it('hides the skip option when every error component is missing from the session', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={['PageLink']} {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preview validation failed'),
      3000,
    );

    // No matching components → no [a] skip line should be rendered.
    expect(frame).not.toContain('[a]');
    expect(frame).toContain('[Enter] Edit definitions');
  });
});

describe('PreviewValidationErrorStep — input', () => {
  it('Enter triggers onEdit', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={[]} {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preview validation failed'),
      3000,
    );

    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onSkip).not.toHaveBeenCalled();
    expect(handlers.onQuit).not.toHaveBeenCalled();
  });

  it('a triggers onSkip when components are matched', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={[]} {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Skip PageLink'),
      3000,
    );

    stdin.write('a');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it('a does NOT trigger onSkip when all components are missing', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={['PageLink']} {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preview validation failed'),
      3000,
    );

    stdin.write('a');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onSkip).not.toHaveBeenCalled();
  });

  it('q triggers onQuit', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <PreviewValidationErrorStep errors={[SLOT_ERROR]} missingNames={[]} {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Preview validation failed'),
      3000,
    );

    stdin.write('q');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onQuit).toHaveBeenCalledTimes(1);
  });
});
