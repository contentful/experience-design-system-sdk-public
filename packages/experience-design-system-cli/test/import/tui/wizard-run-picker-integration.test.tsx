import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { WizardApp } from '../../../src/import/tui/WizardApp.js';
import type { RunRecord } from '../../../src/runs/store.js';

const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

afterEach(() => {
  mockExit.mockClear();
  vi.clearAllMocks();
});

function makeRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    createdAt: '2026-06-25T14:31:00.000Z',
    projectPath: '/work/foo',
    savePath: '/work/foo/dist',
    componentCount: 3,
    tokenCount: 12,
    agent: 'claude',
    pushedTo: null,
    extractSessionId: 'ex',
    generateSessionId: 'gen',
    ...overrides,
  };
}

describe('WizardApp run-picker integration', () => {
  it('renders the run picker before welcome when initialRuns is provided', async () => {
    const { lastFrame } = render(
      <WizardApp initialRuns={[makeRun('AAA'), makeRun('BBB')]} onRunPicked={vi.fn()} />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA') && /Continue from one/i.test(f),
      3000,
    );
    expect(frame).toContain('AAA');
    expect(frame).toContain('BBB');
    expect(frame).not.toMatch(/Where is your component library/);
  });

  it('does not render the run picker when initialRuns is empty', async () => {
    const { lastFrame } = render(<WizardApp initialRuns={[]} onRunPicked={vi.fn()} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.length > 0,
      3000,
    );
    expect(frame).not.toMatch(/Continue from one/i);
  });

  it('does not render the run picker when initialRuns is omitted (welcome shown)', async () => {
    const { lastFrame } = render(<WizardApp />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.length > 0,
      3000,
    );
    expect(frame).not.toMatch(/Continue from one/i);
  });

  it('calls onRunPicked when a run is selected with push', async () => {
    const onRunPicked = vi.fn();
    const { lastFrame, stdin } = render(
      <WizardApp initialRuns={[makeRun('AAA')]} onRunPicked={onRunPicked} />,
    );
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('\r');
    await waitForFrame(() => lastFrame(), (f) => /Push or modify/i.test(f), 3000);
    stdin.write('\r');
    expect(onRunPicked).toHaveBeenCalledWith({ runId: 'AAA', action: 'push' });
  });

  it("advances to welcome when the operator picks 'Start a new run'", async () => {
    const onRunPicked = vi.fn();
    const { lastFrame, stdin } = render(
      <WizardApp initialRuns={[makeRun('AAA')]} onRunPicked={onRunPicked} />,
    );
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('n');
    const welcome = await waitForFrame(
      () => lastFrame(),
      (f) => /Where is your component library/.test(f),
      3000,
    );
    expect(welcome).toBeTruthy();
    expect(onRunPicked).not.toHaveBeenCalled();
  });
});
