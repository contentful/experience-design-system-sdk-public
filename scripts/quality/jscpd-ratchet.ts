import { execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseRef = process.env.GITHUB_BASE_REF || 'main';
const baselineRef = `origin/${baseRef}`;
type Scope = 'v1' | 'cli-v2';

function parseScope(value: string | undefined): Scope {
  if (value === 'v1' || value === 'cli-v2') return value;
  throw new Error('Scope must be one of: v1, cli-v2');
}

const COMMON_IGNORES = ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.nx/**'];

function scanArgs(scope: Scope): string[] {
  const paths = scope === 'v1' ? ['packages'] : ['packages/experience-design-system-cli-v2'];
  const ignores =
    scope === 'v1'
      ? [...COMMON_IGNORES, '**/experience-design-system-cli-v2/**']
      : COMMON_IGNORES;

  return [
    ...paths,
    '--pattern',
    '**/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    '--format',
    'typescript,tsx,javascript',
    '--ignore',
    ignores.join(','),
    '--reporters',
    'console',
    '--no-colors',
    '--no-tips',
  ];
}

async function ensureRefFetched(): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', baselineRef]);
  } catch {
    console.log(`jscpd: fetching ${baselineRef} (not found locally)...`);
    await execFileAsync('git', ['fetch', '--no-tags', 'origin', baseRef]);
  }
}

async function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(scope: Scope, reportOnly: boolean): Promise<void> {
  if (!reportOnly) {
    await ensureRefFetched();
    console.log(`jscpd (${scope}): comparing against ${baselineRef}`);
  }

  const child = execFile(
    'pnpm',
    [
      'exec',
      'jscpd',
      ...(reportOnly ? [] : ['--baseline-from-ref', baselineRef, '--fail-on-new-clones=0']),
      ...scanArgs(scope),
    ],
    { cwd: repoRoot, maxBuffer: 1024 * 1024 * 64 },
  );
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  process.exitCode = await waitForExit(child);
}

try {
  const command = process.argv[2];
  const scope = parseScope(process.argv[3]);
  if (command !== 'check' && command !== 'report') {
    throw new Error('Command must be one of: check, report');
  }
  await main(scope, command === 'report');
} catch (error) {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n` +
      'Usage: tsx scripts/quality/jscpd-ratchet.ts <check|report> <v1|cli-v2>',
  );
  process.exitCode = 1;
}
