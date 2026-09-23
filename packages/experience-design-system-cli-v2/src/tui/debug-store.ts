import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from './package-root.js';
import { readPackageVersion } from './upgrade/version.js';
import { readDebugModeSetting } from './settings/debug-mode/debug-mode-store.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

type PendingRun = {
  flow: string;
  step: string;
  runId: string;
  menuOption: string;
  inputs: Record<string, unknown>;
  startedAt: number;
};

type Status = 'success' | 'error';
type ExitMethod = 'saved' | 'discarded' | 'crashed';

let pendingRun: PendingRun | undefined;

export function generateRunId(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sessionsRootDir(): string {
  return join(findPackageRoot(import.meta.url, PACKAGE_NAME), '.contentful', 'debug', 'sessions');
}

function datePrefix(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// MM-DD-YYYY-session-N: N increments per terminal session started that day (1, 2, 3, ...),
// so runs from the same day group together and still sort in the order they happened.
function generateSessionId(): string {
  const today = datePrefix();

  const root = sessionsRootDir();
  const existing = existsSync(root) ? readdirSync(root) : [];
  const seqPattern = new RegExp(`^${today}-session-(\\d+)$`);
  const maxSeq = existing.reduce((max, entry) => {
    const match = seqPattern.exec(entry);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${today}-session-${maxSeq + 1}`;
}

// Computed once, at module load, rather than lazily — this module is pulled in via
// app.tsx's static imports as soon as the TUI boots, so "once per module load" is
// "once per terminal session."
const SESSION_ID = generateSessionId();

export function getSessionId(): string {
  return SESSION_ID;
}

function sessionDebugDir(): string {
  return join(sessionsRootDir(), SESSION_ID);
}

// Fire-and-forget so a user who never visits a wired flow still sees an (empty)
// session directory the moment they boot — matches startDebugRun's fail-open style.
void isDebugModeEnabled().then((enabled) => {
  if (!enabled) return undefined;
  return mkdir(sessionDebugDir(), { recursive: true });
});

export async function isDebugModeEnabled(): Promise<boolean> {
  try {
    return (await readDebugModeSetting()).enabled;
  } catch {
    return true;
  }
}

export function redact(value: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...value };
  if ('cma_token' in clone) {
    const raw = clone.cma_token;
    clone.cma_token = typeof raw === 'string' && raw.length > 0 ? `[present, ${raw.length} chars]` : '[not set]';
  }
  return clone;
}

export function startDebugRun({
  flow,
  step,
  menuOption,
  inputs,
}: {
  flow: string;
  step: string;
  menuOption: string;
  inputs: Record<string, unknown>;
}): void {
  const runId = generateRunId();
  const startedAt = Date.now();
  const redactedInputs = redact(inputs);

  // isDebugModeEnabled() is async but this function's callers (screen mount
  // effects) call it fire-and-forget. A screen that exits before this
  // resolves just has no pending run, which finishDebugRun treats as a no-op.
  isDebugModeEnabled().then((enabled) => {
    if (!enabled) return;
    pendingRun = { flow, step, runId, menuOption, inputs: redactedInputs, startedAt };
  });
}

export async function finishDebugRun({
  outputs,
  status,
  exitMethod,
}: {
  outputs: Record<string, unknown>;
  status: Status;
  exitMethod: ExitMethod;
}): Promise<void> {
  const run = pendingRun;
  if (!run) return;
  pendingRun = undefined;

  const durationMs = Date.now() - run.startedAt;
  const content = renderMarkdown(run, { outputs: redact(outputs), status, exitMethod, durationMs });

  const flowSegments = run.flow.split('/');
  const dir = join(sessionDebugDir(), ...flowSegments);

  await mkdir(dir, { recursive: true });
  const filename = nextAttemptFilename(dir, run.menuOption);
  await writeFile(join(dir, filename), content, { mode: 0o600 });
}

// MM-DD-YYYY-<menu-option>-attempt-N.md: same date convention as the session directory,
// then the active menu option, then an attempt counter — so repeat visits to the same
// screen within a session don't collide and still sort in the order they happened.
function nextAttemptFilename(dir: string, menuOption: string): string {
  const today = datePrefix();
  const optionSlug = slugify(menuOption);

  const existing = existsSync(dir) ? readdirSync(dir) : [];
  const attemptPattern = new RegExp(`^${today}-${optionSlug}-attempt-(\\d+)\\.md$`);
  const maxAttempt = existing.reduce((max, entry) => {
    const match = attemptPattern.exec(entry);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${today}-${optionSlug}-attempt-${maxAttempt + 1}.md`;
}

function renderMarkdown(
  run: PendingRun,
  finish: { outputs: Record<string, unknown>; status: Status; exitMethod: ExitMethod; durationMs: number },
): string {
  const stepMatch = /^(\d+)-(.+)$/.exec(run.step);
  const stepLabel = stepMatch ? `${stepMatch[1]} - ${stepMatch[2]}` : run.step;
  const flowSlug = run.flow.split('/').join('-');

  return `# Debug Log

- Run ID: ${run.runId}
- Flow: ${flowSlug}
- Step: ${stepLabel}
- Menu option: ${run.menuOption}
- Date: ${new Date().toISOString()}
- CLI version: ${readPackageVersion()}
- Platform: ${process.platform} / Node ${process.version}
- Duration on screen: ${finish.durationMs}ms
- Status: ${finish.status}
- Exit method: ${finish.exitMethod}

## Inputs
\`\`\`json
${JSON.stringify(run.inputs, null, 2)}
\`\`\`

## Outputs
\`\`\`json
${JSON.stringify(finish.outputs, null, 2)}
\`\`\`
`;
}

function handleCrash(): Promise<void> {
  return finishDebugRun({ outputs: {}, status: 'error', exitMethod: 'crashed' });
}

process.once('uncaughtException', (err) => {
  void handleCrash().finally(() => {
    throw err;
  });
});

process.once('unhandledRejection', (reason) => {
  void handleCrash().finally(() => {
    throw reason;
  });
});

process.once('SIGINT', () => {
  void handleCrash().finally(() => {
    process.exit(130);
  });
});
