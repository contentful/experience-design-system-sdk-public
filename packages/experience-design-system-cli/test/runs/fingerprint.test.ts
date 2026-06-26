import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSourceFingerprint, buildSavedFingerprint, sha256Hex } from '../../src/runs/fingerprint.js';

function fakeDb(rows: Array<{ name: string | null; source_path: string | null }>) {
  return {
    prepare: () => ({
      all: () => rows as Array<Record<string, unknown>>,
    }),
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edsi-fingerprint-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildSourceFingerprint', () => {
  it('stats every unique source_path in raw_components and records mtime + componentName', async () => {
    const a = join(dir, 'Button.tsx');
    const b = join(dir, 'Card.tsx');
    await writeFile(a, 'export const Button = () => null;');
    await writeFile(b, 'export const Card = () => null;');

    const db = fakeDb([
      { name: 'Button', source_path: a },
      { name: 'Card', source_path: b },
    ]);
    const fp = await buildSourceFingerprint({ db, extractSessionId: 'e1' });
    expect(Object.keys(fp.files)).toEqual([a, b].sort());
    expect(fp.files[a]?.componentName).toBe('Button');
    expect(fp.files[b]?.componentName).toBe('Card');
    const aStat = await stat(a);
    expect(fp.files[a]?.mtime).toBe(aStat.mtime.toISOString());
  });

  it('deduplicates by source_path (first row wins on componentName)', async () => {
    const a = join(dir, 'Button.tsx');
    await writeFile(a, 'export const Button = () => null;');
    const db = fakeDb([
      { name: 'Button', source_path: a },
      { name: 'ButtonV2', source_path: a },
    ]);
    const fp = await buildSourceFingerprint({ db, extractSessionId: 'e1' });
    expect(fp.files[a]?.componentName).toBe('Button');
    expect(Object.keys(fp.files)).toHaveLength(1);
  });

  it('hashes and stats the raw tokens file when supplied', async () => {
    const tokens = join(dir, 'tokens.json');
    const body = JSON.stringify({ color: { primary: '#fff' } });
    await writeFile(tokens, body);
    const fp = await buildSourceFingerprint({
      db: fakeDb([]),
      extractSessionId: 'e1',
      rawTokensPath: tokens,
    });
    expect(fp.rawTokensPath).toBe(tokens);
    expect(fp.rawTokensContentHash).toBe(sha256Hex(body));
    expect(fp.rawTokensMtime).toBe((await stat(tokens)).mtime.toISOString());
  });

  it('skips rows with null source_path silently', async () => {
    const db = fakeDb([{ name: 'X', source_path: null }]);
    const fp = await buildSourceFingerprint({ db, extractSessionId: 'e1' });
    expect(fp.files).toEqual({});
  });
});

describe('buildSavedFingerprint', () => {
  it('returns SHA-256 hashes of each provided artifact', () => {
    const comps = '{"a":1}';
    const tokens = '{"b":2}';
    const fp = buildSavedFingerprint({ componentsJson: comps, tokensJson: tokens });
    expect(fp.componentsJsonHash).toBe(sha256Hex(comps));
    expect(fp.tokensJsonHash).toBe(sha256Hex(tokens));
  });

  it('returns null for missing artifacts', () => {
    const fp = buildSavedFingerprint({ componentsJson: '{}', tokensJson: null });
    expect(fp.componentsJsonHash).toBe(sha256Hex('{}'));
    expect(fp.tokensJsonHash).toBeNull();
  });
});

// Touch utimes so other suites don't see flaky mtimes — keep the helper in
// the file's surface area for potential reuse.
export async function bumpMtime(p: string, seconds: number): Promise<void> {
  const st = await stat(p);
  const next = new Date(st.mtime.getTime() + seconds * 1000);
  await utimes(p, next, next);
}
