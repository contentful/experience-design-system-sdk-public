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
    tokensPath: null,
    tokenSessionId: null,
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
  it('renders all runs when there are 1-11 (no Show all button)', async () => {
    const ids = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK'];
    const runs = ids.map((id) => makeRun(id));
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA') && f.includes('KKK'),
      3000,
    );
    for (const id of ids) expect(frame).toContain(id);
    expect(frame).not.toContain('Show all');
    expect(frame).toContain('Start a new run');
  });

  it('renders top 10 + Show all when there are 12+', async () => {
    const ids = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK', 'LLL'];
    const runs = ids.map((id) => makeRun(id));
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA') && f.includes('Show all'),
      3000,
    );
    for (const id of ids.slice(0, 10)) expect(frame).toContain(id);
    expect(frame).not.toContain('KKK');
    expect(frame).not.toContain('LLL');
    expect(frame).toContain('Show all (12)');
  });

  it('expands to show all entries after pressing Enter on Show all', async () => {
    const ids = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK', 'LLL'];
    const runs = ids.map((id) => makeRun(id));
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Show all'),
      3000,
    );
    for (let i = 0; i < 10; i++) stdin.write('j');
    stdin.write('\r');
    const expanded = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('KKK') && f.includes('LLL'),
      3000,
    );
    for (const id of ids) expect(expanded).toContain(id);
    expect(expanded).not.toContain('Show all');
  });

  it('moves cursor with j/k and fires onSelect with action=push (default) on Enter', async () => {
    const runs = [makeRun('AAA'), makeRun('BBB'), makeRun('CCC')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA'),
      3000,
    );
    stdin.write('j');
    stdin.write('\r');
    const sub = await waitForFrame(
      () => lastFrame(),
      (f) => /Push or modify/i.test(f),
      3000,
    );
    expect(sub).toMatch(/Push/);
    expect(sub).toMatch(/Modify/);
    stdin.write('\r');
    expect(handlers.onSelect).toHaveBeenCalledWith({ runId: 'BBB', action: 'push' });
  });

  it('routes to modify when the operator picks Modify on the action screen', async () => {
    const runs = [makeRun('AAA')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA'),
      3000,
    );
    stdin.write('\r');
    await waitForFrame(
      () => lastFrame(),
      (f) => /Push or modify/i.test(f),
      3000,
    );
    stdin.write('j');
    stdin.write('\r');
    expect(handlers.onSelect).toHaveBeenCalledWith({ runId: 'AAA', action: 'modify' });
  });

  it('Cancel on the action screen returns to the picker', async () => {
    const runs = [makeRun('AAA'), makeRun('BBB')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA'),
      3000,
    );
    stdin.write('\r');
    await waitForFrame(
      () => lastFrame(),
      (f) => /Push or modify/i.test(f),
      3000,
    );
    stdin.write('j');
    stdin.write('j');
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
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA'),
      3000,
    );
    stdin.write('n');
    expect(handlers.onSelect).toHaveBeenCalledWith({ runId: null, action: 'new' });
  });

  it('pressing q calls onCancel', async () => {
    const runs = [makeRun('AAA')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AAA'),
      3000,
    );
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
    expect(frame).toMatch(/2026-06-25 \d{2}:\d{2}/);
    expect(frame).toMatch(/2026-06-24 \d{2}:\d{2}/);
    expect(frame).toContain('pushed');
    expect(frame).toContain('not pushed');
  });
});
