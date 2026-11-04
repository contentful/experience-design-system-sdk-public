import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const requireFromRoot = createRequire(join(root, 'package.json'));
it('invokes non-CLI packages once each and isolates CLI without changing budgets', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'quality-scope-'));
  try {
    const capture = join(temporary, 'argv.json');
    const shim = join(temporary, 'pnpm');
    writeFileSync(
      shim,
      '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.SCOPE_CAPTURE,JSON.stringify(process.argv.slice(2)));process.stdout.write(JSON.stringify({issues:[]}));\n',
    );
    chmodSync(shim, 0o755);
    const live = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}`)
      .filter((workspace) => existsSync(join(root, workspace, 'package.json')))
      .sort();
    for (const scope of ['legacy', 'cli']) {
      await run(
        process.execPath,
        [requireFromRoot.resolve('tsx/cli'), join(root, 'scripts/quality/knip-ratchet.ts'), 'check', scope],
        { cwd: root, env: { ...process.env, PATH: temporary + ':' + process.env.PATH, SCOPE_CAPTURE: capture } },
      );
      const args: string[] = JSON.parse(readFileSync(capture, 'utf8'));
      const selected = args.flatMap((arg, index) => (arg === '--workspace' ? [args[index + 1]!] : []));
      expect(selected).toEqual(
        scope === 'cli'
          ? ['packages/experience-design-system-cli']
          : live.filter((path) => path !== 'packages/experience-design-system-cli'),
      );
      expect(new Set(selected).size).toBe(selected.length);
    }
    expect(JSON.parse(readFileSync(join(root, 'scripts/quality/knip-budget.json'), 'utf8'))).toEqual({
      legacy: 0,
      cli: 0,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
