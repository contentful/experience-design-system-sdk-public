import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListRuns } = vi.hoisted(() => ({
  mockListRuns: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  listRuns: mockListRuns,
}));

import { runLsCommand } from '../../src/runs/ls-command.js';
import type { RunRecord } from '../../src/runs/store.js';

const sampleRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: '01HXYZABCDEFGHJKMNPQRSTVWXY',
  createdAt: '2026-06-24T14:31:00.000Z',
  projectPath: '/Users/m/work/foo',
  savePath: '/Users/m/dist',
  componentCount: 12,
  tokenCount: 24,
  agent: 'claude',
  pushedTo: { spaceId: 'fhuxdukarhrp', environmentId: 'dsi100', host: 'https://api.contentful.com' },
  extractSessionId: 'e1',
  generateSessionId: 'g1',
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('runLsCommand', () => {
  it('renders a table of recent runs', async () => {
    mockListRuns.mockResolvedValueOnce([
      sampleRun(),
      sampleRun({ id: '01HXYZBBBBBBBBBBBBBBBBBBBB', componentCount: 8, pushedTo: null, createdAt: '2026-06-23T09:18:00.000Z' }),
    ]);
    const out: string[] = [];
    await runLsCommand({ write: (s) => out.push(s) });
    const text = out.join('');
    expect(text).toContain('ID');
    expect(text).toContain('CREATED');
    expect(text).toContain('PROJECT');
    expect(text).toContain('01HXYZ');
    expect(text).toContain('/Users/m/work/foo');
    expect(text).toContain('fhuxdukarhrp/dsi100');
    expect(text).toContain('(not pushed)');
  });

  it('prints an empty-history message when no runs exist', async () => {
    mockListRuns.mockResolvedValueOnce([]);
    const out: string[] = [];
    await runLsCommand({ write: (s) => out.push(s) });
    const text = out.join('');
    expect(text.toLowerCase()).toMatch(/no runs|empty/);
  });

  it('filters by --project', async () => {
    mockListRuns.mockResolvedValueOnce([sampleRun()]);
    await runLsCommand({ write: () => undefined, projectPath: '/Users/m/work/foo' });
    expect(mockListRuns).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/Users/m/work/foo' }));
  });
});
