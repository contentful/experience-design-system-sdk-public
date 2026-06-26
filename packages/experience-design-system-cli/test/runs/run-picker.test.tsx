import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../helpers/wait-for-frame.js';
import { RunPicker } from '../../src/runs/run-picker.js';
import type { RunRecord } from '../../src/runs/store.js';

afterEach(() => {
  vi.clearAllMocks();
});

function makeRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    createdAt: '2026-06-25T14:31:00.000Z',
    projectPath: '/work/foo',
    savePath: '/work/foo/dist',
    componentCount: 12,
    tokenCount: 0,
    agent: 'claude',
    pushedTo: { spaceId: 's', environmentId: 'master', host: 'api.contentful.com' },
    extractSessionId: 'extract',
    generateSessionId: 'gen',
    ...overrides,
  };
}

function makeHandlers() {
  return {
    onSelect: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('RunPicker', () => {
  it('renders all runs when there are 1-4 (no Show all button)', async () => {
    const runs = [makeRun('AAA'), makeRun('BBB'), makeRun('CCC'), makeRun('DDD')];
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA') && f.includes('DDD'),
      3000,
    );
    expect(frame).toContain('AAA');
    expect(frame).toContain('BBB');
    expect(frame).toContain('CCC');
    expect(frame).toContain('DDD');
    expect(frame).not.toContain('Show all');
    expect(frame).toContain('Start a new run');
  });

  it('renders top 3 + Show all when there are 5+', async () => {
    const runs = [
      makeRun('AAA'),
      makeRun('BBB'),
      makeRun('CCC'),
      makeRun('DDD'),
      makeRun('EEE'),
    ];
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA') && f.includes('Show all'),
      3000,
    );
    expect(frame).toContain('AAA');
    expect(frame).toContain('BBB');
    expect(frame).toContain('CCC');
    expect(frame).not.toContain('DDD');
    expect(frame).not.toContain('EEE');
    expect(frame).toContain('Show all (5)');
  });

  it('expands to show all entries after pressing Enter on Show all', async () => {
    const runs = [
      makeRun('AAA'),
      makeRun('BBB'),
      makeRun('CCC'),
      makeRun('DDD'),
      makeRun('EEE'),
    ];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(() => lastFrame(), (f) => f.includes('Show all'), 3000);
    // Navigate down to the Show all row (after 3 runs) then press Enter.
    // Default cursor is at index 0; press j 3 times to reach index 3 (Show all).
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    stdin.write('\r');
    const expanded = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('DDD') && f.includes('EEE'),
      3000,
    );
    expect(expanded).toContain('AAA');
    expect(expanded).toContain('DDD');
    expect(expanded).toContain('EEE');
    expect(expanded).not.toContain('Show all');
  });

  it('moves cursor with j/k and fires onSelect with action=push (default) on Enter', async () => {
    const runs = [makeRun('AAA'), makeRun('BBB'), makeRun('CCC')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('j');
    stdin.write('\r');
    // After selecting a run we move to the "Push or modify?" screen.
    const sub = await waitForFrame(
      () => lastFrame(),
      (f) => /Push or modify/i.test(f),
      3000,
    );
    expect(sub).toMatch(/Push/);
    expect(sub).toMatch(/Modify/);
    // Default cursor is on Push — pressing Enter routes to push.
    stdin.write('\r');
    expect(handlers.onSelect).toHaveBeenCalledWith({ runId: 'BBB', action: 'push' });
  });

  it('routes to modify when the operator picks Modify on the action screen', async () => {
    const runs = [makeRun('AAA')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('\r'); // pick AAA
    await waitForFrame(() => lastFrame(), (f) => /Push or modify/i.test(f), 3000);
    stdin.write('j'); // move to Modify
    stdin.write('\r');
    expect(handlers.onSelect).toHaveBeenCalledWith({ runId: 'AAA', action: 'modify' });
  });

  it('Cancel on the action screen returns to the picker', async () => {
    const runs = [makeRun('AAA'), makeRun('BBB')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('\r'); // pick AAA
    await waitForFrame(() => lastFrame(), (f) => /Push or modify/i.test(f), 3000);
    stdin.write('j');
    stdin.write('j'); // navigate to Cancel
    stdin.write('\r');
    const back = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Continue from one') && f.includes('AAA'),
      3000,
    );
    expect(back).toContain('AAA');
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it('pressing n fires onSelect with action=new', async () => {
    const runs = [makeRun('AAA')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('n');
    expect(handlers.onSelect).toHaveBeenCalledWith({ runId: null, action: 'new' });
  });

  it('pressing q calls onCancel', async () => {
    const runs = [makeRun('AAA')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(() => lastFrame(), (f) => f.includes('AAA'), 3000);
    stdin.write('q');
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it('formats date as YYYY-MM-DD HH:MM and includes pushed / not pushed', async () => {
    const runs = [
      makeRun('PUSHED', { createdAt: '2026-06-25T14:31:00.000Z' }),
      makeRun('UNPUSHED', { createdAt: '2026-06-24T09:18:00.000Z', pushedTo: null }),
    ];
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('PUSHED') && f.includes('UNPUSHED'),
      3000,
    );
    // We use local-time formatting so we can't pin the exact hour, but the
    // date portion is stable and the "pushed" / "not pushed" tag must appear.
    expect(frame).toMatch(/2026-06-25 \d{2}:\d{2}/);
    expect(frame).toMatch(/2026-06-24 \d{2}:\d{2}/);
    expect(frame).toContain('pushed');
    expect(frame).toContain('not pushed');
  });
});
