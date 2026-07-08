/**
 * Tier 5 — `experiences analyze extract`.
 *
 * The non-TTY branch (headless) writes:
 *   stdout: `session=<id>\n`
 *   stderr: `Scanned N source file(s) in <dir>\n` + `Extracted M component(s)\n` + warnings
 *
 * See analyze/command.ts lines 285–319.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { REACT_MINIMAL } from './helpers/fixtures.mjs';

describe('analyze extract', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('--project reports session id and extracted count', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const { stdout, stderr, code } = await runCli(
      ['analyze', 'extract', '--project', REACT_MINIMAL],
      { env: t.env },
    );
    expect(code).toBe(0);
    // The session line is the single stdout line the wizard uses to
    // resume from a prior extract.
    expect(stdout).toMatch(/^session=[a-z0-9-]+/m);
    // Summary lines land on stderr.
    expect(stderr).toMatch(/Scanned \d+ source files?/);
    // react-minimal has 3 components; extractor may report more before
    // filtering. Assert on the invariant lower bound.
    expect(stderr).toMatch(/Extracted \d+ components?/);
    const m = stderr.match(/Extracted (\d+) components?/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(3);
  });

  it('--dir <sub> scopes extraction to a subdirectory of the project', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    // Build a tmp project with two component dirs; extract only one via
    // --dir. This proves the flag narrows the scan.
    const proj = join(t.home, 'proj');
    mkdirSync(join(proj, 'src', 'a'), { recursive: true });
    mkdirSync(join(proj, 'src', 'b'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'p' }));
    writeFileSync(
      join(proj, 'src', 'a', 'AlphaOnly.tsx'),
      "export function AlphaOnly({ label }: { label: string }) { return <div>{label}</div>; }\n",
    );
    writeFileSync(
      join(proj, 'src', 'b', 'BetaOnly.tsx'),
      "export function BetaOnly({ label }: { label: string }) { return <div>{label}</div>; }\n",
    );

    const { stderr, code } = await runCli(
      ['analyze', 'extract', '--project', proj, '--dir', 'src/a'],
      { env: t.env },
    );
    expect(code).toBe(0);
    // Scoped to src/a — only AlphaOnly should appear. BetaOnly's file
    // shouldn't be scanned, so its name must not surface in warnings/errors.
    expect(stderr).not.toMatch(/BetaOnly/);
  });

  it('--dir with a nonexistent path exits 1 with a clear error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const proj = join(t.home, 'proj');
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'p' }));

    const { stderr, code } = await runCli(
      ['analyze', 'extract', '--project', proj, '--dir', 'does/not/exist'],
      { env: t.env },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/source directory does not exist/);
  });

  it('--resolve-unreachable rejects invalid modes', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const { stderr, code } = await runCli(
      [
        'analyze',
        'extract',
        '--project',
        REACT_MINIMAL,
        '--resolve-unreachable',
        'sometimes',
      ],
      { env: t.env },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--resolve-unreachable must be one of/);
  });
});
