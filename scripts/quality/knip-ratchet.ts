import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const budgetPath = path.join(scriptDir, 'knip-budget.json');

type KnipIssueEntry = Record<string, unknown[] | string | undefined>;
type Scope = 'v1' | 'cli-v2';
type KnipBudgets = Record<Scope, number>;

const NON_ISSUE_FIELDS = new Set(['file', 'owners']);
const SCOPE_OPTIONS: Record<Scope, string[]> = {
  v1: [
    '--workspace',
    'packages/*',
    '--workspace',
    '!packages/experience-design-system-cli-v2',
  ],
  'cli-v2': ['--workspace', 'packages/experience-design-system-cli-v2'],
};

function parseScope(value: string | undefined): Scope {
  if (value === 'v1' || value === 'cli-v2') return value;
  throw new Error('Scope must be one of: v1, cli-v2');
}

async function runKnip(scope: Scope): Promise<{ issues: KnipIssueEntry[] }> {
  try {
    const { stdout } = await execFileAsync(
      'pnpm',
      ['exec', 'knip', ...SCOPE_OPTIONS[scope], '--reporter', 'json', '--no-exit-code'],
      { cwd: repoRoot, maxBuffer: 1024 * 1024 * 64 },
    );
    return { issues: (JSON.parse(stdout) as { issues: KnipIssueEntry[] }).issues };
  } catch (error) {
    const execError = error as { stdout?: string };
    if (!execError.stdout) throw error;
    return { issues: (JSON.parse(execError.stdout) as { issues: KnipIssueEntry[] }).issues };
  }
}

function countIssues(issues: KnipIssueEntry[]): number {
  let total = 0;
  for (const entry of issues) {
    for (const [field, value] of Object.entries(entry)) {
      if (NON_ISSUE_FIELDS.has(field)) continue;
      if (Array.isArray(value)) total += value.length;
    }
  }
  return total;
}

async function readBudgets(): Promise<KnipBudgets> {
  const raw = await readFile(budgetPath, 'utf8');
  return JSON.parse(raw) as KnipBudgets;
}

async function writeBudget(scope: Scope, maxIssues: number): Promise<void> {
  const budgets = await readBudgets();
  budgets[scope] = maxIssues;
  await writeFile(budgetPath, `${JSON.stringify(budgets, null, 2)}\n`);
}

async function check(scope: Scope): Promise<void> {
  const [{ issues }, budgets] = await Promise.all([runKnip(scope), readBudgets()]);
  const count = countIssues(issues);
  const budget = budgets[scope];

  if (count > budget) {
    console.error(
      `knip (${scope}): ${count} issues exceeds the budget of ${budget} (see scripts/quality/knip-budget.json).\n` +
        'Run "pnpm exec knip" to see the findings, or "pnpm quality:baseline" after deliberate cleanup.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`knip (${scope}): ${count} issues (budget: ${budget}) — OK`);
  if (count < budget) console.log(`Note: the budget could be ratcheted down to ${count}.`);
}

async function baseline(scope: Scope): Promise<void> {
  const { issues } = await runKnip(scope);
  const count = countIssues(issues);
  await writeBudget(scope, count);
  console.log(`knip (${scope}): budget updated to ${count} issues.`);
}

async function report(scope: Scope): Promise<void> {
  const { issues } = await runKnip(scope);
  console.log(JSON.stringify(issues, null, 2));
  console.log(`\nTotal (${scope}): ${countIssues(issues)} issues`);
}

try {
  const command = process.argv[2];
  const scope = parseScope(process.argv[3]);

  switch (command) {
    case 'check':
      await check(scope);
      break;
    case 'baseline':
      await baseline(scope);
      break;
    case 'report':
      await report(scope);
      break;
    default:
      throw new Error('Command must be one of: check, baseline, report');
  }
} catch (error) {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n` +
      'Usage: tsx scripts/quality/knip-ratchet.ts <check|baseline|report> <v1|cli-v2>',
  );
  process.exitCode = 1;
}
