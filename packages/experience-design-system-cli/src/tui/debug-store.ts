import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readSettings } from '@contentful/experience-design-system-types/config';
import { readPackageVersion } from './home/version.js';
import { readDebugModeSetting } from './settings/debug-mode/debug-mode-store.js';
import { pruneExpiredLogs } from './debug-prune.js';

type PendingRun = {
  flow: string;
  step: string;
  menuOption: string;
  inputs: Record<string, unknown>;
  startedAt: number;
  // What a long run has found so far. A crash or Ctrl+C writes this instead of an empty log.
  progress?: Record<string, unknown>;
  progressSummary?: string[];
};

type Status = 'success' | 'error';
type ExitMethod = 'saved' | 'discarded' | 'crashed';

let pendingRun: PendingRun | undefined;

// What the user chose to import at the Preflight, in the words they saw. It decides which steps run and is held until the
// import ends, so every import log says it in its header instead of each step being told.
let importMode: string | undefined;

/** Set when the user chooses at the Preflight, and cleared when the Preflight opens again. */
export function setDebugImportMode(label: string | undefined): void {
  importMode = label;
}

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
    await writeWaitingLogs();
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
void Promise.all([isDebugModeEnabled(), readBaseDir()]).then(async ([enabled, base]) => {
  if (!base) return;
  // Expired logs go whether or not logging is on now, so turning it off does not keep old ones around.
  const retention = await readDebugModeSetting().catch(() => undefined);
  const pruned = retention ? await pruneExpiredLogs(base, retention.retentionDays).catch(() => undefined) : undefined;
  if (!enabled) return;
  const debugDir = join(startSession(base, { replace: false }), 'debug');
  await mkdir(debugDir, { recursive: true });
  await writeWaitingLogs();
  // Say what was deleted, so "my logs are gone" can be answered from the log. Nothing is written when nothing expired.
  if (retention && pruned && pruned.logs + pruned.folders > 0) {
    await writeFile(
      join(debugDir, `${datePrefix()}-cleanup-${generateRunId()}.md`),
      `# Debug Log Cleanup

- Date: ${new Date().toISOString()}
- Retention: ${retention.retentionDays} days
- Logs deleted: ${pruned.logs}
- Empty folders removed: ${pruned.folders}
`,
      { mode: 0o600 },
    );
  }
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
  inputs = {},
}: {
  flow: string;
  step: string;
  menuOption: string;
  /** What the step starts with. A step that writes a `summary` when it finishes leaves this out and puts its facts in the data. */
  inputs?: Record<string, unknown>;
}): void {
  const startedAt = Date.now();
  const redactedInputs = redact(inputs);

  // The run is registered at once. Reading Debug Mode is async, and a step that ends before it has been read must still be
  // logged as itself: if it were registered late, its finish would be dropped and the next step's finish would land on it,
  // mixing the two logs. When Debug Mode turns out to be off the run is withdrawn here, and finishDebugRun checks again
  // before it writes.
  const run: PendingRun = { flow, step, menuOption, inputs: redactedInputs, startedAt };
  pendingRun = run;
  void isDebugModeEnabled().then((enabled) => {
    if (!enabled && pendingRun === run) pendingRun = undefined;
  });
}

/**
 * Keeps what the open run has so far, in memory. It is only written if the run is cut short, in the same layout as a
 * finished log when a `summary` is given.
 */
export function setDebugRunProgress(outputs: Record<string, unknown>, summary?: string[]): void {
  if (!pendingRun) return;
  pendingRun.progress = outputs;
  pendingRun.progressSummary = summary;
}

// Logs that are still being written. Finishing a log is not instant, and something that reads the logs the moment a step
// fails (the zip for support) has to wait for the log of that very step, so it can wait on these.
const unsettled = new Set<Promise<unknown>>();

function track<T>(work: Promise<T>): Promise<T> {
  unsettled.add(work);
  const forget = (): void => void unsettled.delete(work);
  work.then(forget, forget);
  return work;
}

/** Resolves once every log that has been finished is on disk. */
export async function settleDebugLogs(): Promise<void> {
  while (unsettled.size > 0) await Promise.allSettled([...unsettled]);
}

type FinishArgs = {
  outputs: Record<string, unknown>;
  /**
   * The facts for a person, one line each; every two spaces a line is indented by nest it one level under the line above. With it the log
   * has a Summary (for people) and a Data (for AI, the outputs) section that say the same thing twice. Without it the log
   * keeps its Inputs and Outputs sections. The lines are written as given, so a step must not put a secret in one.
   */
  summary?: string[];
  status: Status;
  exitMethod: ExitMethod;
};

export function finishDebugRun(args: FinishArgs): Promise<void> {
  return track(finishRun(args));
}

async function finishRun({ outputs, summary, status, exitMethod }: FinishArgs): Promise<void> {
  const run = pendingRun;
  if (!run) return;
  pendingRun = undefined;
  if (!(await isDebugModeEnabled())) return;

  const durationMs = Date.now() - run.startedAt;
  const log: FinishedLog = {
    folder: logFolder(run.flow, run.step),
    menuOption: run.menuOption,
    content: renderMarkdown(run, { outputs: redact(outputs), summary, status, exitMethod, durationMs }),
  };

  // Without a session folder yet (no base directory is configured and the import has not started) the log waits.
  const root = currentDebugSessionDir();
  if (!root) {
    if (waiting.length < WAITING_LIMIT) waiting.push(log);
    return;
  }
  await writeLog(root, log);
}

type FinishedLog = { folder: string; menuOption: string; content: string };

// Import steps are numbered ("04-credentials"), so their folders carry the number and a file browser lists them in the
// order the steps run. Other flows keep the folder named after the flow.
function logFolder(flow: string, step: string): string {
  return flow.startsWith('import/') && /^\d+-/.test(step) ? `import/${step}` : flow;
}

// The first import steps finish before the project, and so the session folder, is known. Their logs wait here and are
// written, in order and once, when the folder is created. The limit keeps a long session with no folder from growing.
const WAITING_LIMIT = 50;
const waiting: FinishedLog[] = [];

async function writeLog(root: string, log: FinishedLog): Promise<void> {
  const dir = join(root, ...log.folder.split('/'));
  await mkdir(dir, { recursive: true });
  const filename = nextAttemptFilename(dir, log.menuOption);
  await writeFile(join(dir, filename), log.content, { mode: 0o600 });
}

async function writeWaitingLogs(): Promise<void> {
  const root = currentDebugSessionDir();
  if (!root) return;
  for (const log of waiting.splice(0)) {
    try {
      await writeLog(root, log);
    } catch {
      // Debug logging must never get in the way of the user.
    }
  }
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
  finish: Required<Pick<FinishArgs, 'outputs' | 'status' | 'exitMethod'>> &
    Pick<FinishArgs, 'summary'> & { durationMs: number },
): string {
  const stepNumber = /^(\d+)-/.exec(run.step)?.[1];
  const title = stepNumber ? `${run.menuOption} · step ${stepNumber}` : run.menuOption;
  const when = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const mode = run.flow.startsWith('import/') && importMode ? `\nImport mode: ${importMode}` : '';
  const header = `# ${title}

${when} · ${finish.durationMs}ms on screen · ${finish.status} (${finish.exitMethod}) · CLI ${readPackageVersion()} · ${process.platform} / Node ${process.version}${mode}
`;

  if (finish.summary) {
    // Each two spaces a line starts with is one level of nesting under the line above it.
    const bullets = finish.summary.map((line) => {
      const depth = Math.floor((line.length - line.trimStart().length) / 2);
      return `${'  '.repeat(depth)}- ${line.trim()}`;
    });
    return `${header}
## Summary (for people)
${bullets.join('\n')}

## Data (for AI)
\`\`\`json
${JSON.stringify(finish.outputs, null, 2)}
\`\`\`
`;
  }

  return `${header}
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
  return finishDebugRun({
    outputs: pendingRun?.progress ?? {},
    summary: pendingRun?.progressSummary,
    status: 'error',
    exitMethod: 'crashed',
  });
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

// Ctrl+C, `kill` and closing the terminal window. Only a hard kill (SIGKILL) cannot be caught.
for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
] as const) {
  process.once(signal, () => {
    void handleCrash().finally(() => {
      process.exit(exitCode);
    });
  });
}
