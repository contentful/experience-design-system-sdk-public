import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, stat, utimes, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRunStaleness } from '../../src/runs/staleness.js';
import { sha256Hex } from '../../src/runs/fingerprint.js';
import type { RunRecord } from '../../src/runs/store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edsi-staleness-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function bumpMtime(p: string, seconds: number): Promise<void> {
  const st = await stat(p);
  const next = new Date(st.mtime.getTime() + seconds * 1000);
  await utimes(p, next, next);
}

function runWith(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: 'r1',
    createdAt: '2026-06-25T00:00:00.000Z',
    projectPath: '/p',
    savePath: dir,
    componentCount: 1,
    tokenCount: 0,
    tokensPath: null,
    tokenSessionId: null,
    agent: 'claude',
    pushedTo: null,
    extractSessionId: 'e1',
    generateSessionId: null,
    sourceFingerprint: null,
    savedFingerprint: null,
    ...overrides,
  };
}

describe('checkRunStaleness', () => {
  it('returns UNKNOWN-but-not-stale for v2 records without a sourceFingerprint', async () => {
    const run = runWith({ sourceFingerprint: null });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(false);
    expect(s.staleComponents).toEqual([]);
    expect(s.staleTokens).toBe(false);
  });

  it('returns FRESH when every fingerprinted file still matches', async () => {
    const src = join(dir, 'Button.tsx');
    await writeFile(src, 'x');
    const st = await stat(src);
    const run = runWith({
      sourceFingerprint: {
        files: { [src]: { mtime: st.mtime.toISOString(), componentName: 'Button' } },
        rawTokensPath: null,
        rawTokensMtime: null,
        rawTokensContentHash: null,
      },
    });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(false);
  });

  it('flags a component as stale when its source file mtime drifts', async () => {
    const src = join(dir, 'Button.tsx');
    await writeFile(src, 'x');
    const original = await stat(src);
    await bumpMtime(src, 60);
    const run = runWith({
      sourceFingerprint: {
        files: { [src]: { mtime: original.mtime.toISOString(), componentName: 'Button' } },
        rawTokensPath: null,
        rawTokensMtime: null,
        rawTokensContentHash: null,
      },
    });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(true);
    expect(s.staleComponents).toContain('Button');
  });

  it('reports a missing source file separately from mtime drift', async () => {
    const src = join(dir, 'Button.tsx');
    await writeFile(src, 'x');
    const st = await stat(src);
    await unlink(src);
    const run = runWith({
      sourceFingerprint: {
        files: { [src]: { mtime: st.mtime.toISOString(), componentName: 'Button' } },
        rawTokensPath: null,
        rawTokensMtime: null,
        rawTokensContentHash: null,
      },
    });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(true);
    expect(s.missingSourceFiles).toContain(src);
  });

  it('flags raw tokens when its mtime OR content hash drifts', async () => {
    const t = join(dir, 'tokens.json');
    await writeFile(t, '{"a":1}');
    const st = await stat(t);
    await writeFile(t, '{"a":2}'); // changes hash AND mtime
    const run = runWith({
      sourceFingerprint: {
        files: {},
        rawTokensPath: t,
        rawTokensMtime: st.mtime.toISOString(),
        rawTokensContentHash: sha256Hex('{"a":1}'),
      },
    });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(true);
    expect(s.staleTokens).toBe(true);
  });

  it('flags savedComponentsEdited when components.json hash drifts', async () => {
    const comp = join(dir, 'components.json');
    await writeFile(comp, '{"original":true}');
    const recordedHash = sha256Hex('{"original":true}');
    await writeFile(comp, '{"edited":true}');
    const run = runWith({
      sourceFingerprint: { files: {}, rawTokensPath: null, rawTokensMtime: null, rawTokensContentHash: null },
      savedFingerprint: { componentsJsonHash: recordedHash, tokensJsonHash: null },
    });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(true);
    expect(s.savedComponentsEdited).toBe(true);
  });

  it('flags savedTokensEdited when the saved tokens.json is missing', async () => {
    const tokensPath = join(dir, 'tokens.json');
    const run = runWith({
      tokensPath,
      sourceFingerprint: { files: {}, rawTokensPath: null, rawTokensMtime: null, rawTokensContentHash: null },
      savedFingerprint: { componentsJsonHash: null, tokensJsonHash: sha256Hex('{"any":true}') },
    });
    const s = await checkRunStaleness(run);
    expect(s.stale).toBe(true);
    expect(s.savedTokensEdited).toBe(true);
  });
});
