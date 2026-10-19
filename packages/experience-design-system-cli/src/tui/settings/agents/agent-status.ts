import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import {
  AGENT_BINARIES,
  DEFAULT_MODELS,
  checkAgentAuth,
  createLocalCliAgentInvoker,
  type AgentName,
} from '@contentful/experience-design-system-backend-pipeline';

// What the Agents screen can tell the user about an agent before an import fails on it.
//
// The checks are layered, cheapest first, and each one only runs if the one before it passed:
//
//   1. path     the binary exists and is executable                       every agent
//   2. version  `<binary> --version` answers                              every agent (verified on claude and copilot)
//   3. login    `claude auth status --json` says loggedIn                 claude only: no other agent has a login check
//   4. prompt   one tiny real prompt through the import's own code path   every agent, opt-in (spends a few tokens)
//
// Steps 1 to 3 are the "quick" inspection shown on each row. Step 4 is the explicit "Run a full test" action.

type AgentCheckStep = 'path' | 'version' | 'login' | 'prompt';

export type AgentCheck = {
  step: AgentCheckStep;
  ok: boolean;
  /** One line for the user: the version string, the reason it failed, or what to run next. */
  detail: string;
};

/** The one-word state shown on an agent's row. `unknown` means it runs but its login cannot be checked. */
export type AgentStatus = 'checking' | 'ready' | 'not-found' | 'not-logged-in' | 'unknown';

const VERSION_TIMEOUT_MS = 5000;
const PROMPT_TIMEOUT_MS = 60_000;
const TEST_PROMPT = 'Reply with the single word: ok';

// What to run to get each agent working. Cursor and Copilot are installed outside npm, so they get a pointer, not a command.
const INSTALL_HINTS: Record<AgentName, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  opencode: 'npm install -g opencode-ai',
  cursor: 'install Cursor’s `cursor-agent` command',
  copilot: 'npm install -g @github/copilot',
};

const LOGIN_HINTS: Record<AgentName, string> = {
  claude: 'run `claude login`',
  codex: 'set OPENAI_API_KEY, or sign in with a ChatGPT account',
  opencode: 'run `opencode auth`',
  cursor: 'sign in from Cursor',
  copilot: 'run `copilot` and sign in',
};

/**
 * The binary the import will actually run for this agent: the saved path if there is one, otherwise the built-in
 * command name. Shown in the form so the user sees what is used when the field is empty.
 */
export function effectiveBinary(name: AgentName, savedBinary: string): string {
  return savedBinary.trim() || AGENT_BINARIES[name];
}

/** The model the agent runs with when none is saved ("haiku", "gpt-mini", or the agent's own pick), for the model row. */
export function defaultModelLabel(name: AgentName): string {
  // Copilot's "Auto" means --model is left out, which is the same thing as the agent choosing.
  const model = DEFAULT_MODELS[name];
  return model && model !== 'Auto' ? model : 'chosen by the agent';
}

const fail = (step: AgentCheckStep, detail: string): AgentCheck => ({ step, ok: false, detail });
const pass = (step: AgentCheckStep, detail: string): AgentCheck => ({ step, ok: true, detail });

/** A bare command name is looked up on the PATH; anything with a slash is a file. */
function resolveOnPath(binary: string): Promise<string | null> {
  if (binary.includes('/')) {
    return access(binary, constants.X_OK).then(
      () => binary,
      () => null,
    );
  }
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [binary], (error, stdout) =>
      resolve(error ? null : (stdout.split('\n')[0]?.trim() ?? null)),
    );
  });
}

function readVersion(binary: string): Promise<AgentCheck> {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: VERSION_TIMEOUT_MS }, (error, stdout) => {
      const line = stdout.split('\n')[0]?.trim() ?? '';
      if (!error && line) resolve(pass('version', line));
      // An agent that does not answer --version may still run. That is "can't verify", not "broken".
      else resolve(fail('version', 'runs, but did not report a version'));
    });
  });
}

/**
 * Steps 1 to 3 against `binary`. Never throws and never spends tokens, so it is safe to run for every row on open.
 * Checks the path the user typed, not what is saved, so the form can test a value before it is written.
 */
export async function inspectAgent(name: AgentName, binary: string): Promise<AgentCheck[]> {
  const target = effectiveBinary(name, binary);
  const found = await resolveOnPath(target);
  if (!found) return [fail('path', `\`${target}\` was not found or is not executable`)];

  const checks: AgentCheck[] = [pass('path', found)];
  checks.push(await readVersion(found));

  if (name === 'claude') {
    // checkAgentAuth reads the binary from the environment, so point it at the one being inspected.
    const auth = await withBinaryEnv(name, found, () => checkAgentAuth(name));
    checks.push(
      auth === 'ok'
        ? pass('login', 'logged in')
        : fail('login', auth === 'not-found' ? 'binary not found' : `not logged in: ${LOGIN_HINTS.claude}`),
    );
  }
  return checks;
}

/** Steps 1 to 4. The prompt step is the only way to verify login and model name for agents other than claude. */
export async function testAgent(name: AgentName, binary: string, model: string): Promise<AgentCheck[]> {
  const checks = await inspectAgent(name, binary);
  if (!checks.every((check) => check.step === 'version' || check.ok)) return checks;

  const target = effectiveBinary(name, binary);
  const found = (await resolveOnPath(target)) ?? target;
  const started = Date.now();
  const result = await withBinaryEnv(name, found, () =>
    createLocalCliAgentInvoker().invoke({
      agent: name,
      ...(model.trim() ? { model: model.trim() } : {}),
      prompt: TEST_PROMPT,
      timeoutMs: PROMPT_TIMEOUT_MS,
    }),
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.timedOut) return [...checks, fail('prompt', `no answer within ${PROMPT_TIMEOUT_MS / 1000}s`)];
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split('\n').pop()?.slice(0, 160) || `exited with code ${result.exitCode}`;
    return [...checks, fail('prompt', reason)];
  }
  return [...checks, pass('prompt', `answered in ${seconds}s`)];
}

/** Collapses a list of checks into the status shown on the row. */
export function statusFromChecks(name: AgentName, checks: readonly AgentCheck[]): AgentStatus {
  if (checks.length === 0) return 'checking';
  if (checks.some((check) => check.step === 'path' && !check.ok)) return 'not-found';
  const login = checks.find((check) => check.step === 'login');
  if (login) return login.ok ? 'ready' : 'not-logged-in';
  const prompt = checks.find((check) => check.step === 'prompt');
  if (prompt) return prompt.ok ? 'ready' : 'not-logged-in';
  // It exists and runs, but this agent has no login check, so ready would be a guess.
  return name === 'claude' ? 'ready' : 'unknown';
}

/** What to tell a user whose agent is not ready: the install command, or the login command. Empty when nothing is needed. */
export function nextStepHint(name: AgentName, status: AgentStatus): string {
  if (status === 'not-found') return INSTALL_HINTS[name];
  if (status === 'not-logged-in') return LOGIN_HINTS[name];
  if (status === 'unknown') return 'run a full test to confirm it is logged in';
  return '';
}

/** The pipeline reads an agent's binary from EDS_AGENT_BINARY_<AGENT>, so a check on a specific path sets it for the call. */
async function withBinaryEnv<T>(name: AgentName, binary: string, run: () => Promise<T>): Promise<T> {
  const key = `EDS_AGENT_BINARY_${name.toUpperCase()}`;
  const previous = process.env[key];
  process.env[key] = binary;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}
