import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readSettings } from '@contentful/experience-design-system-types/config';
import { readPackageVersion } from './home/version.js';
import { readDebugModeSetting } from './settings/debug-mode/debug-mode-store.js';

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

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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

// Where the user asked `.contentful` to live (Settings > Contentful Configuration). Empty means the structure is only
// created once the import knows its project.
async function readBaseDir(): Promise<string | undefined> {
  try {
    const dir = (await readSettings())['contentfulBaseDir'];
    return typeof dir === 'string' && dir !== '' ? resolve(dir) : undefined;
  } catch {
    return undefined;
  }
}

// MM-DD-YYYY-session-N: N increments per terminal session started that day (1, 2, 3, ...),
// so runs from the same day group together and still sort in the order they happened.
function nextSessionId(contentfulDir: string): string {
  const today = datePrefix();
  const existing = existsSync(contentfulDir) ? readdirSync(contentfulDir) : [];
  const seqPattern = new RegExp(`^${today}-session-(\\d+)$`);
  const maxSeq = existing.reduce((max, entry) => {
    const match = seqPattern.exec(entry);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${today}-session-${maxSeq + 1}`;
}

// This terminal session's folder: <base>/.contentful/<session>/. Set once, from the configured base directory at boot
// or, when none is configured, from the project the import is started for.
let sessionDir: string | undefined;

function startSession(base: string, { replace }: { replace: boolean }): string {
  const contentfulDir = join(base, '.contentful');
  if (replace || !sessionDir) sessionDir = join(contentfulDir, nextSessionId(contentfulDir));
  return sessionDir;
}

// Folder this terminal session writes its debug logs to, or undefined until it is known.
export function currentDebugSessionDir(): string | undefined {
  return sessionDir && join(sessionDir, 'debug');
}

/** This terminal session's folder, `<base>/.contentful/<session>/`, or undefined until it is known. */
export function currentSessionDir(): string | undefined {
  return sessionDir;
}

/**
 * Starts this terminal session's folder in `base`. The base directory setting being saved passes `replace` so the new
 * location wins; the import passes nothing and only starts a session when none exists yet. Fail-open like the rest of
 * the logger.
 */
export async function startDebugSessionIn(base: string, { replace = false } = {}): Promise<void> {
  try {
    if (!(await isDebugModeEnabled())) return;
    await mkdir(join(startSession(resolve(base), { replace }), 'debug'), { recursive: true });
  } catch {
    // Debug logging must never get in the way of the user.
  }
}

// Every import run gets its own folder in the session, dsi-import-1, dsi-import-2, ..., so a second import in the same
// terminal session never overwrites the first.
function nextImportRunDir(session: string): string {
  const existing = existsSync(session) ? readdirSync(session) : [];
  const maxRun = existing.reduce((max, entry) => {
    const match = /^dsi-import-(\d+)$/.exec(entry);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return join(session, `dsi-import-${maxRun + 1}`);
}

/**
 * Where this import run writes everything it produces (tokens.json, .existing-entities.json, components.json): a new
 * `dsi-import-N` folder in this session's folder, next to the debug logs. The session is started here, and waited for,
 * so the answer does not depend on how quickly the boot-time start finished. Without a session (Debug Mode off, or a
 * folder that cannot be created) the files stay in `<project>/.contentful`, as before.
 */
export async function startImportRun(projectPath: string): Promise<string> {
  await startDebugSessionIn(projectPath);
  if (!sessionDir) return join(resolve(projectPath), '.contentful');
  const dir = nextImportRunDir(sessionDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Fire-and-forget so a user who never visits a wired flow still sees an (empty)
// session directory the moment they boot — matches startDebugRun's fail-open style.
void Promise.all([isDebugModeEnabled(), readBaseDir()]).then(([enabled, base]) => {
  if (!enabled || !base) return undefined;
  return mkdir(join(startSession(base, { replace: false }), 'debug'), { recursive: true });
});

async function isDebugModeEnabled(): Promise<boolean> {
  try {
    return (await readDebugModeSetting()).enabled;
  } catch {
    return true;
  }
}

function redact(value: Record<string, unknown>): Record<string, unknown> {
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

  // Without a configured base directory nothing is logged until the import has started the session.
  const root = currentDebugSessionDir();
  if (!root) return;
  const flowSegments = run.flow.split('/');
  const dir = join(root, ...flowSegments);

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
