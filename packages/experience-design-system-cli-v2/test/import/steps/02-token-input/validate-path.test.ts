import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateTokenPath } from '../../../../src/tui/import/steps/02-token-input/validate-path.js';

let dir: string;
let tokensFile: string;
let subDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'token-path-'));
  tokensFile = join(dir, 'tokens.json');
  subDir = join(dir, 'folder');
  writeFileSync(tokensFile, '{}');
  mkdirSync(subDir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('validateTokenPath', () => {
  it('accepts an existing file and returns its absolute path', () => {
    expect(validateTokenPath(tokensFile)).toEqual({ ok: true, path: tokensFile });
  });

  it('accepts a quoted path, since that is how terminals paste paths with spaces', () => {
    expect(validateTokenPath(`"${tokensFile}"`)).toEqual({ ok: true, path: tokensFile });
  });

  it('rejects a missing path and reports what it resolved to', () => {
    const missing = join(dir, 'nope.json');

    expect(validateTokenPath(missing)).toEqual({
      ok: false,
      error: `Path not found: ${missing}`,
      resolvedPath: missing,
    });
  });

  it('rejects a directory with a hint to point at a file', () => {
    const result = validateTokenPath(subDir);

    expect(result).toMatchObject({ ok: false, resolvedPath: subDir });
    expect(result.ok === false && result.error).toContain("That's a directory");
  });
});
