import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { GateStep } from '../../../src/import/tui/steps/GateStep.js';

afterEach(() => {
  vi.clearAllMocks();
});

function makeHandlers() {
  return {
    onContinue: vi.fn(),
    onSkip: vi.fn(),
    onQuit: vi.fn(),
  };
}

describe('GateStep — intent prop', () => {
  it("defaults to 'success' intent (green ✓ header)", async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(<GateStep successMessage="All good" context="proceed?" {...handlers} />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('All good'),
      3000,
    );

    expect(frame).toContain('✓');
    expect(frame).not.toContain('✗');
  });

  it("renders ✗ when intent='error'", async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <GateStep intent="error" successMessage="It broke" context="now what?" {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('It broke'),
      3000,
    );

    expect(frame).toContain('✗');
    // Ensure no green checkmark leaks through.
    expect(frame).not.toContain('✓ It broke');
  });

  it("explicit intent='success' still renders ✓", async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(<GateStep intent="success" successMessage="Yay" context="continue?" {...handlers} />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Yay'),
      3000,
    );

    expect(frame).toContain('✓');
  });
});

describe('GateStep — input handling', () => {
  it('Enter triggers onContinue', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<GateStep successMessage="hi" context="ctx" {...handlers} />);

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('hi'),
      3000,
    );

    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
  });

  it("'a' triggers onSkip when showSkip=true and onSkip is set", async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<GateStep successMessage="hi" context="ctx" showSkip={true} {...handlers} />);

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('hi'),
      3000,
    );

    stdin.write('a');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
  });

  it("'a' is a no-op when showSkip=false", async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<GateStep successMessage="hi" context="ctx" showSkip={false} {...handlers} />);

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('hi'),
      3000,
    );

    stdin.write('a');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onSkip).not.toHaveBeenCalled();
  });

  it("'q' triggers onQuit", async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<GateStep successMessage="hi" context="ctx" {...handlers} />);

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('hi'),
      3000,
    );

    stdin.write('q');
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onQuit).toHaveBeenCalledTimes(1);
  });

  it('escape triggers onQuit', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<GateStep successMessage="hi" context="ctx" {...handlers} />);

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('hi'),
      3000,
    );

    stdin.write('\x1b'); // ESC
    await new Promise((r) => setTimeout(r, 50));

    expect(handlers.onQuit).toHaveBeenCalledTimes(1);
  });
});

describe('GateStep — labels and summary', () => {
  it('shows custom continueLabel and skipLabel', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <GateStep
        successMessage="ok"
        context="ctx"
        continueLabel="Edit definitions"
        skipLabel="Skip and retry"
        showSkip={true}
        {...handlers}
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Edit definitions'),
      3000,
    );

    expect(frame).toContain('[Enter] Edit definitions');
    expect(frame).toContain('[a] Skip and retry');
  });

  it('omits the skip line when showSkip=false', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <GateStep successMessage="ok" context="ctx" skipLabel="should-not-appear" showSkip={false} {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('ok'),
      3000,
    );

    expect(frame).not.toContain('should-not-appear');
    expect(frame).not.toContain('[a]');
  });

  it('renders summary when provided', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <GateStep successMessage="header" summary="line1\n  line2: detail" context="ctx" {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('line1') || f.includes('header'),
      3000,
    );

    expect(frame).toContain('line1');
  });
});
