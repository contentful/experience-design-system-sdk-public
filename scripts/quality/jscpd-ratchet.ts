import { execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseRef = process.env.GITHUB_BASE_REF || 'main';
const baselineRef = `origin/${baseRef}`;
type Scope = 'legacy';

function parseScope(value: string | undefined): Scope {
  if (value === 'legacy') return value;
  throw new Error('Scope must be: legacy');
}

// cli is deliberately not scanned: its screens keep their logic separate even where two are identical.
const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.nx/**',
  '**/experience-design-system-cli/src/tui/**',
  '**/experience-design-system-cli/src/api/**',
  '**/experience-design-system-cli/src/legacy/**',
];

function scanArgs(): string[] {
  return [
    'packages',
    '--pattern',
    '**/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    '--format',
    'typescript,tsx,javascript',
    '--ignore',
    IGNORES.join(','),
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
      ...scanArgs(),
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
      'Usage: tsx scripts/quality/jscpd-ratchet.ts <check|report> legacy',
  );
  process.exitCode = 1;
}
