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
    projectPath: `/work/${id.toLowerCase()}`,
    savePath: `/work/${id.toLowerCase()}/dist`,
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
      (f) => f.includes('aaa') && f.includes('kkk'),
      3000,
    );
    for (const id of ids) expect(frame).toContain(id.toLowerCase());
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
      (f) => f.includes('aaa') && f.includes('Show all'),
      3000,
    );
    for (const id of ids.slice(0, 10)) expect(frame).toContain(id.toLowerCase());
    expect(frame).not.toContain('kkk');
    expect(frame).not.toContain('lll');
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
      (f) => f.includes('kkk') && f.includes('lll'),
      3000,
    );
    for (const id of ids) expect(expanded).toContain(id.toLowerCase());
    expect(expanded).not.toContain('Show all');
  });

  it('moves cursor with j/k and fires onSelect with action=push (default) on Enter', async () => {
    const runs = [makeRun('AAA'), makeRun('BBB'), makeRun('CCC')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('aaa'),
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
      (f) => f.includes('aaa'),
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
      (f) => f.includes('aaa'),
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
      (f) => f.includes('Continue from one') && f.includes('aaa'),
      3000,
    );
    expect(back).toContain('aaa');
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it('pressing n fires onSelect with action=new', async () => {
    const runs = [makeRun('AAA')];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('aaa'),
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
      (f) => f.includes('aaa'),
      3000,
    );
    stdin.write('q');
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it('renders each row as <leaf> <relative-time> <count> <push-status> <agent>', async () => {
    const runs = [
      makeRun('PUSHED', {
        projectPath: '/work/cx-simple-exo',
        createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        pushedTo: { spaceId: 'abc123', environmentId: 'master', host: 'api.contentful.com' },
        agent: 'claude',
      }),
      makeRun('UNPUSHED', {
        projectPath: '/personal/other-repo',
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        pushedTo: null,
        agent: 'codex',
      }),
    ];
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('cx-simple-exo') && f.includes('other-repo'),
      3000,
    );
    expect(frame).toMatch(/cx-simple-exo\s+20m ago\s+12 components\s+→ abc123\/master\s+claude/);
    expect(frame).toMatch(/other-repo\s+3h ago\s+12 components\s+not pushed\s+codex/);
  });

  it('disambiguates colliding leaf names by expanding to <parent>/<leaf>', async () => {
    const runs = [
      makeRun('AAA', { projectPath: '/work/design-system' }),
      makeRun('BBB', { projectPath: '/personal/design-system' }),
    ];
    const handlers = makeHandlers();
    const { lastFrame } = render(<RunPicker runs={runs} {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('work/design-system') && f.includes('personal/design-system'),
      3000,
    );
    expect(frame).toContain('work/design-system');
    expect(frame).toContain('personal/design-system');
  });

  it('shows the full ULID for the highlighted row in the details footer', async () => {
    const runs = [
      makeRun('06G8FJ4J3MBXKSQKJDYR3G6X1C', { projectPath: '/work/alpha' }),
      makeRun('06G8FH4BSGB2S807B5AYSN5CSR', { projectPath: '/work/beta' }),
    ];
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(<RunPicker runs={runs} {...handlers} />);
    let frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('ID:'),
      3000,
    );
    expect(frame).toContain('ID: 06G8FJ4J3MBXKSQKJDYR3G6X1C');
    stdin.write('j');
    frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('ID: 06G8FH4BSGB2S807B5AYSN5CSR'),
      3000,
    );
    expect(frame).toContain('ID: 06G8FH4BSGB2S807B5AYSN5CSR');
  });
});
