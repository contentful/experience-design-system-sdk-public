import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListRuns, mockResolveRunTarget } = vi.hoisted(() => ({
  mockListRuns: vi.fn(),
  mockResolveRunTarget: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  listRuns: mockListRuns,
}));

vi.mock('../../src/runs/resolve-run-target.js', () => ({
  resolveRunTarget: mockResolveRunTarget,
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
  tokensPath: '/Users/m/dist/tokens.json',
  tokenSessionId: 'tokens-abc',
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

  it('renders long project and save paths without truncation', async () => {
    const longProject = '/Users/michael.pineiro/BossOS/scratch/dsi-mock-library/components';
    const longSave = '/Users/michael.pineiro/BossOS/scratch/dsi-mock-library/components/.contentful';
    mockListRuns.mockResolvedValueOnce([
      sampleRun({ projectPath: longProject, savePath: longSave }),
    ]);
    const out: string[] = [];
    await runLsCommand({ write: (s) => out.push(s) });
    const text = out.join('');
    expect(text).toContain(longProject);
    expect(text).toContain(longSave);
  });

  describe('STALE column and status block', () => {
    it('adds a STALE header to the table and renders empty cells for fresh / UNKNOWN runs', async () => {
      mockListRuns.mockResolvedValueOnce([sampleRun()]);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s) });
      const text = out.join('');
      expect(text).toContain('STALE');
    });

    it('detail view prints Status: UNKNOWN for v2 records without a sourceFingerprint', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(sampleRun({ sourceFingerprint: null }));
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      expect(out.join('')).toContain('Status: UNKNOWN');
    });

    it('detail view prints Status: FRESH when the fingerprint matches an empty source set', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(
        sampleRun({
          sourceFingerprint: { files: {}, rawTokensPath: null, rawTokensMtime: null, rawTokensContentHash: null },
          savedFingerprint: { componentsJsonHash: null, tokensJsonHash: null },
        }),
      );
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      expect(out.join('')).toContain('Status: FRESH');
    });
  });

  describe('single-run detail view', () => {
    it('prints detail block when positional id is supplied', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(sampleRun());
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      const text = out.join('');
      expect(mockResolveRunTarget).toHaveBeenCalledWith('01HXYZABCDEFGHJKMNPQRSTVWXY');
      expect(text).toContain('Run 01HXYZABCDEFGHJKMNPQRSTVWXY');
      expect(text).toContain('Created:');
      expect(text).toContain('Project:');
      expect(text).toContain('/Users/m/work/foo');
      expect(text).toContain('Saved:');
      expect(text).toContain('Components: 12');
      expect(text).toContain('Tokens:');
      expect(text).toContain('Agent:');
      expect(text).toContain('Pushed:');
      expect(text).toContain('fhuxdukarhrp/dsi100');
      expect(text).toContain('experiences import --push-from-run 01HXYZABCDEFGHJKMNPQRSTVWXY');
      expect(text).toContain('experiences import --modify 01HXYZABCDEFGHJKMNPQRSTVWXY');
      expect(text).not.toMatch(/^ID\s+CREATED/m);
    });

    it('renders the tokens-saved path when tokensPath is set', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(
        sampleRun({ tokensPath: '/Users/m/custom-out/tokens.json' }),
      );
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      const text = out.join('');
      expect(text).toContain('Tokens saved: /Users/m/custom-out/tokens.json');
    });

    it('omits the tokens-saved line when tokensPath is null', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(sampleRun({ tokensPath: null }));
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      expect(out.join('')).not.toContain('Tokens saved');
    });

    it('resolves positional path via resolveRunTarget', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(sampleRun({ id: 'RUNXYZ' }));
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '/Users/m/work/foo' });
      expect(mockResolveRunTarget).toHaveBeenCalledWith('/Users/m/work/foo');
      const text = out.join('');
      expect(text).toContain('Run RUNXYZ');
    });

    it('shows "(not pushed)" in detail view when pushedTo is null', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(sampleRun({ pushedTo: null }));
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      expect(out.join('')).toContain('(not pushed)');
    });

    it('surfaces resolveRunTarget errors', async () => {
      mockResolveRunTarget.mockRejectedValueOnce(new Error('Run nope not found in ~/.config/experiences/runs.json'));
      await expect(
        runLsCommand({ write: () => undefined, target: 'nope' }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('--json output', () => {
    it('emits RunRecord[] as JSON when no positional', async () => {
      const runs = [sampleRun(), sampleRun({ id: 'R2', pushedTo: null })];
      mockListRuns.mockResolvedValueOnce(runs);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), json: true });
      const parsed = JSON.parse(out.join(''));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('01HXYZABCDEFGHJKMNPQRSTVWXY');
    });

    it('emits a single object when positional + --json', async () => {
      mockResolveRunTarget.mockResolvedValueOnce(sampleRun());
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), json: true, target: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
      const parsed = JSON.parse(out.join(''));
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed.id).toBe('01HXYZABCDEFGHJKMNPQRSTVWXY');
    });
  });

  describe('--pushed / --not-pushed filters', () => {
    it('filters to pushed runs only', async () => {
      mockListRuns.mockResolvedValueOnce([
        sampleRun({ id: 'A' }),
        sampleRun({ id: 'B', pushedTo: null }),
        sampleRun({ id: 'C' }),
      ]);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), pushed: true });
      const text = out.join('');
      expect(text).toContain('A');
      expect(text).toContain('C');
      expect(text).not.toMatch(/\bB\b/);
    });

    it('filters to unpushed runs only', async () => {
      mockListRuns.mockResolvedValueOnce([
        sampleRun({ id: 'A' }),
        sampleRun({ id: 'B', pushedTo: null }),
        sampleRun({ id: 'C', pushedTo: null }),
      ]);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), notPushed: true });
      const text = out.join('');
      expect(text).toContain('B');
      expect(text).toContain('C');
      expect(text).not.toMatch(/\bA\b/);
    });

    it('rejects --pushed and --not-pushed together', async () => {
      await expect(
        runLsCommand({ write: () => undefined, pushed: true, notPushed: true }),
      ).rejects.toThrow(/mutually exclusive|cannot.*both/i);
    });
  });

  describe('footer hints', () => {
    it('renders next-command hints after the table using the newest run id', async () => {
      mockListRuns.mockResolvedValueOnce([
        sampleRun({ id: 'NEWEST' }),
        sampleRun({ id: 'OLDER' }),
      ]);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s) });
      const text = out.join('');
      expect(text).toContain('experiences import --push-from-run NEWEST');
      expect(text).toContain('experiences import --modify NEWEST');
      const tail = text.slice(text.length - 200);
      expect(tail).toContain('--push-from-run');
    });

    it('suppresses the footer when there are no runs', async () => {
      mockListRuns.mockResolvedValueOnce([]);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s) });
      expect(out.join('')).not.toContain('--push-from-run');
    });

    it('suppresses the footer under --json', async () => {
      mockListRuns.mockResolvedValueOnce([sampleRun()]);
      const out: string[] = [];
      await runLsCommand({ write: (s) => out.push(s), json: true });
      expect(out.join('')).not.toContain('experiences import --push-from-run');
    });
  });
});
