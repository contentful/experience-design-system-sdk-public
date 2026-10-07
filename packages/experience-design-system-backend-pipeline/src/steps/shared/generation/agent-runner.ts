import { spawn } from 'node:child_process';
import type { AgentName } from './agent-names.js';

export { AGENT_NAMES, DEFAULT_AGENT_NAME, isAgentName, type AgentName } from './agent-names.js';

export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// --- Tool call protocol ---

export interface ClassifyPropCall {
  tool: 'classify_prop';
  prop: string;
  cdf_type: string;
  cdf_category: 'content' | 'design' | 'state';
  values?: string[];
  token_kind?: string;
  required?: boolean;
  description?: string;
  default?: string | boolean;
  /** Internal LLM rationale; not customer-facing. Persisted to raw_props.rationale. */
  reason?: string;
}

export interface ExcludePropCall {
  tool: 'exclude_prop';
  prop: string;
  reason: string;
}

export interface ClassifyComponentCall {
  tool: 'classify_component';
  description?: string;
  /**
   * Component-level rationale strings. Surfaced by the `I` ComponentRationalePanel.
   * Each field is optional; missing fields leave existing DB values untouched
   * (sparse update semantics in applyToolCalls).
   */
  rationale?: {
    description?: string;
    props?: string;
    slots?: string;
  };
}

export interface ClassifySlotCall {
  tool: 'classify_slot';
  slot: string;
  required?: boolean;
  allowed_components?: string[];
  description?: string;
  /** Per-slot rationale; persisted to raw_slots.rationale. */
  rationale?: string;
}

export type ToolCall = ClassifyPropCall | ExcludePropCall | ClassifyComponentCall | ClassifySlotCall;

// --- Select tool calls ---

export interface SelectComponentCall {
  tool: 'select_component';
  name: string;
  reason?: string;
  confidence?: number; // 1–5 scale, agent's certainty this belongs in ExO
}

export interface RejectComponentCall {
  tool: 'reject_component';
  name: string;
  reason?: string;
  confidence?: number; // 1–5 scale, agent's certainty this should be excluded
}

export type SelectToolCall = SelectComponentCall | RejectComponentCall;

export interface ParsedSelectToolCalls {
  calls: SelectToolCall[];
  warnings: string[];
}

const VALID_SELECT_TOOL_NAMES = new Set(['select_component', 'reject_component']);

function findJsonObjectEnd(line: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (escaped) {
      escaped = false;
    } else if (ch === '\\' && inString) {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString && ch === '{') {
      depth++;
    } else if (!inString && ch === '}' && --depth === 0) {
      return i;
    }
  }

  return -1;
}

/**
 * Reads an agent's stdout into the tool-call objects it carries. Lines that do
 * not start with `{` are the agent's prose and are skipped silently, as before.
 */
function readToolCallObjects(stdout: string): {
  objects: Array<Record<string, unknown>>;
  warnings: string[];
} {
  const objects: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;

    const end = findJsonObjectEnd(line);
    if (end === -1) {
      warnings.push(`unparseable line: ${line.slice(0, 120)}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(0, end + 1));
    } catch {
      warnings.push(`unparseable line: ${line.slice(0, 120)}`);
      continue;
    }
    const trailing = line.slice(end + 1);
    if (trailing.trim()) {
      warnings.push(`ignored trailing content after JSON: ${trailing.trim().slice(0, 120)}`);
    }
    if (typeof parsed === 'object' && parsed !== null && 'tool' in parsed) {
      objects.push(parsed as Record<string, unknown>);
    }
  }

  return { objects, warnings };
}

export function parseSelectToolCallLines(stdout: string): ParsedSelectToolCalls {
  const calls: SelectToolCall[] = [];
  const { objects, warnings } = readToolCallObjects(stdout);

  for (const rec of objects) {
    if (!VALID_SELECT_TOOL_NAMES.has(rec.tool as string)) continue;

    if (typeof rec.name !== 'string' || !rec.name) {
      warnings.push(`${String(rec.tool)} missing name — skipped`);
      continue;
    }

    const call = {
      tool: rec.tool as SelectToolCall['tool'],
      name: rec.name,
    } as SelectToolCall;
    if (typeof rec.reason === 'string') (call as SelectComponentCall).reason = rec.reason;
    if (typeof rec.confidence === 'number' && rec.confidence >= 1 && rec.confidence <= 5) {
      if (call.tool === 'select_component') {
        (call as SelectComponentCall).confidence = rec.confidence;
      } else {
        (call as RejectComponentCall).confidence = rec.confidence;
      }
    }
    calls.push(call);
  }

  return { calls, warnings };
}

// --- Token tool calls ---

export interface SetTokenCall {
  tool: 'set_token';
  path: string; // dot-notation DTCG path, e.g. "colors.brand.primary"
  type: string; // DTCG $type, e.g. "color"
  value: unknown; // $value — may be string, number, array, or object
  description?: string;
}

export interface SetGroupCall {
  tool: 'set_group';
  path: string; // dot-notation group path, e.g. "colors.brand"
  description?: string;
}

export type TokenToolCall = SetTokenCall | SetGroupCall;

export interface ParsedTokenToolCalls {
  calls: TokenToolCall[];
  warnings: string[];
}

export interface ParsedToolCalls {
  calls: ToolCall[];
  warnings: string[];
}

const VALID_TOOL_NAMES = new Set(['classify_prop', 'exclude_prop', 'classify_component', 'classify_slot']);
const VALID_TOKEN_TOOL_NAMES = new Set(['set_token', 'set_group']);
const VALID_CDF_TYPES = new Set(['string', 'richtext', 'media', 'enum', 'token', 'boolean']);
const VALID_CATEGORIES = new Set(['content', 'design', 'state']);

export function parseToolCallLines(stdout: string): ParsedToolCalls {
  const calls: ToolCall[] = [];
  const { objects, warnings } = readToolCallObjects(stdout);

  for (const rec of objects) {
    if (!VALID_TOOL_NAMES.has(rec.tool as string)) {
      warnings.push(`unknown tool: ${String(rec.tool)}`);
      continue;
    }

    const tool = rec.tool as ToolCall['tool'];

    if (tool === 'classify_prop') {
      if (typeof rec.prop !== 'string' || !rec.prop) {
        warnings.push('classify_prop missing prop name — skipped');
        continue;
      }
      if (typeof rec.cdf_type !== 'string' || !VALID_CDF_TYPES.has(rec.cdf_type)) {
        warnings.push(`classify_prop '${rec.prop}': invalid cdf_type '${String(rec.cdf_type)}' — skipped`);
        continue;
      }
      if (typeof rec.cdf_category !== 'string' || !VALID_CATEGORIES.has(rec.cdf_category)) {
        warnings.push(`classify_prop '${rec.prop}': invalid cdf_category '${String(rec.cdf_category)}' — skipped`);
        continue;
      }
      const call: ClassifyPropCall = {
        tool: 'classify_prop',
        prop: rec.prop,
        cdf_type: rec.cdf_type,
        cdf_category: rec.cdf_category as ClassifyPropCall['cdf_category'],
      };
      if (Array.isArray(rec.values) && rec.values.every((v) => typeof v === 'string')) {
        call.values = rec.values as string[];
      }
      if (typeof rec.token_kind === 'string') call.token_kind = rec.token_kind;
      if (typeof rec.required === 'boolean') call.required = rec.required;
      if (typeof rec.description === 'string') call.description = rec.description;
      if (typeof rec.default === 'string' || typeof rec.default === 'boolean') call.default = rec.default;
      if (typeof rec.reason === 'string') call.reason = rec.reason;
      calls.push(call);
    } else if (tool === 'exclude_prop') {
      if (typeof rec.prop !== 'string' || !rec.prop) {
        warnings.push('exclude_prop missing prop name — skipped');
        continue;
      }
      calls.push({
        tool: 'exclude_prop',
        prop: rec.prop,
        reason: typeof rec.reason === 'string' ? rec.reason : '',
      });
    } else if (tool === 'classify_component') {
      const call: ClassifyComponentCall = { tool: 'classify_component' };
      if (typeof rec.description === 'string') call.description = rec.description;
      if (typeof rec.rationale === 'object' && rec.rationale !== null) {
        const r = rec.rationale as Record<string, unknown>;
        const rationale: NonNullable<ClassifyComponentCall['rationale']> = {};
        if (typeof r.description === 'string') rationale.description = r.description;
        if (typeof r.props === 'string') rationale.props = r.props;
        if (typeof r.slots === 'string') rationale.slots = r.slots;
        if (Object.keys(rationale).length > 0) call.rationale = rationale;
      }
      calls.push(call);
    } else if (tool === 'classify_slot') {
      if (typeof rec.slot !== 'string' || !rec.slot) {
        warnings.push('classify_slot missing slot name — skipped');
        continue;
      }
      const call: ClassifySlotCall = { tool: 'classify_slot', slot: rec.slot };
      if (typeof rec.required === 'boolean') call.required = rec.required;
      if (Array.isArray(rec.allowed_components) && rec.allowed_components.every((v) => typeof v === 'string')) {
        call.allowed_components = rec.allowed_components as string[];
      }
      if (typeof rec.description === 'string') call.description = rec.description;
      if (typeof rec.rationale === 'string') call.rationale = rec.rationale;
      calls.push(call);
    }
  }

  return { calls, warnings };
}

export function parseTokenToolCallLines(stdout: string): ParsedTokenToolCalls {
  const calls: TokenToolCall[] = [];
  const { objects, warnings } = readToolCallObjects(stdout);

  for (const rec of objects) {
    if (!VALID_TOKEN_TOOL_NAMES.has(rec.tool as string)) continue; // not a token call — skip silently

    if (rec.tool === 'set_token') {
      if (typeof rec.path !== 'string' || !rec.path) {
        warnings.push('set_token missing path — skipped');
        continue;
      }
      if (typeof rec.type !== 'string' || !rec.type) {
        warnings.push(`set_token '${rec.path}': missing type — skipped`);
        continue;
      }
      if (!('value' in rec)) {
        warnings.push(`set_token '${rec.path}': missing value — skipped`);
        continue;
      }
      const call: SetTokenCall = { tool: 'set_token', path: rec.path, type: rec.type, value: rec.value };
      if (typeof rec.description === 'string') call.description = rec.description;
      calls.push(call);
    } else if (rec.tool === 'set_group') {
      if (typeof rec.path !== 'string' || !rec.path) {
        warnings.push('set_group missing path — skipped');
        continue;
      }
      const call: SetGroupCall = { tool: 'set_group', path: rec.path };
      if (typeof rec.description === 'string') call.description = rec.description;
      calls.push(call);
    }
  }

  return { calls, warnings };
}

// --- Map-tokens tool calls ---

export interface MapTokenPropCall {
  tool: 'map_token_prop';
  component: string;
  prop: string;
  /** Narrowed subset of tokens the prop may draw from. Required and non-empty. */
  token_allowed: string[];
}

export interface ParsedMapTokenPropToolCalls {
  calls: MapTokenPropCall[];
  warnings: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseMapTokenPropToolCallLines(stdout: string): ParsedMapTokenPropToolCalls {
  const calls: MapTokenPropCall[] = [];
  const warnings: string[] = [];

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      warnings.push(`unparseable line: ${line.slice(0, 120)}`);
      continue;
    }

    if (typeof obj !== 'object' || obj === null || !('tool' in obj)) continue;
    const rec = obj as Record<string, unknown>;

    if (rec.tool !== 'map_token_prop') continue; // not a map-tokens call — skip silently

    if (typeof rec.component !== 'string' || !rec.component) {
      warnings.push('map_token_prop missing component — skipped');
      continue;
    }
    if (typeof rec.prop !== 'string' || !rec.prop) {
      warnings.push(`map_token_prop '${rec.component}': missing prop — skipped`);
      continue;
    }
    if (!isStringArray(rec.token_allowed) || rec.token_allowed.length === 0) {
      warnings.push(`map_token_prop '${rec.component}.${String(rec.prop)}': missing or empty token_allowed — skipped`);
      continue;
    }

    const call: MapTokenPropCall = {
      tool: 'map_token_prop',
      component: rec.component,
      prop: rec.prop,
      token_allowed: rec.token_allowed,
    };
    calls.push(call);
  }

  return { calls, warnings };
}

// --- Agent invocation ---

const AGENT_BINARIES: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  copilot: 'copilot',
};

export function resolveBinary(agent: AgentName): string {
  const envKey = `EDS_AGENT_BINARY_${agent.toUpperCase()}`;
  const override = process.env[envKey];
  if (override && override.trim()) return override.trim();
  return AGENT_BINARIES[agent];
}

/** Per-agent env vars that switch model calls to AWS Bedrock. */
const BEDROCK_ENV_BY_AGENT: Partial<Record<AgentName, Record<string, string>>> = {
  claude: { CLAUDE_CODE_USE_BEDROCK: '1' },
};

/**
 * Agents with a working Bedrock routing mechanism, of any shape (env var,
 * argv config override, or a provider-prefixed model string) — not just the
 * env-var agents in BEDROCK_ENV_BY_AGENT. cursor is excluded: its own Bedrock
 * support is currently broken for non-interactive/CI use.
 */
const BEDROCK_CAPABLE_AGENTS = new Set<AgentName>(['claude', 'codex', 'opencode']);

export function agentSupportsBedrock(agent: AgentName): boolean {
  return BEDROCK_CAPABLE_AGENTS.has(agent);
}

const DEFAULT_CODEX_BEDROCK_REGION = 'us-east-1';

const DEFAULT_OPENCODE_MODEL = 'claude-haiku-4-5';

/**
 * Default models per agent — lightweight/fast picks to control cost when no
 * explicit model is configured. cursor uses `gpt-mini` (verified alias from
 * GetUsableModels; haiku is not available in cursor's model catalog).
 *
 * codex is deliberately absent: with no entry here it gets no `--model` at
 * all, so the installed Codex CLI picks whatever its account supports. On
 * Bedrock it still needs an explicit id, since the model id there carries an
 * `openai.` prefix required by the Bedrock provider and absent from the
 * direct api.openai.com id — see DEFAULT_CODEX_BEDROCK_MODEL.
 */
const DEFAULT_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'haiku',
  opencode: DEFAULT_OPENCODE_MODEL,
  cursor: 'gpt-mini', // cursor alias for gpt-5.4-mini-medium; haiku not in cursor's catalog
  copilot: 'Auto', // the only model guaranteed on every Copilot plan (Free/Pro/Business/Enterprise); Pro+ users override via EDS_AGENT_MODEL_COPILOT
};

const DEFAULT_CODEX_BEDROCK_MODEL = 'openai.gpt-5.6-luna';

/**
 * Resolve the model for an agent. Explicit flag/creds value wins, then a
 * per-agent `EDS_AGENT_MODEL_<AGENT>` env override (mirrors the
 * `EDS_AGENT_BINARY_<AGENT>` pattern), otherwise the lightweight default for
 * that agent. `bedrock` only affects the fallback default, and only for
 * agents whose model id changes shape under Bedrock (codex, opencode) — an
 * explicit value or env override is never rewritten.
 */
export function resolveAgentModel(agent: AgentName, explicit?: string, bedrock = false): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  const override = process.env[`EDS_AGENT_MODEL_${agent.toUpperCase()}`];
  if (override && override.trim()) return override.trim();
  if (bedrock && agent === 'codex') return DEFAULT_CODEX_BEDROCK_MODEL;
  if (bedrock && agent === 'opencode') return withBedrockProviderPrefix(DEFAULT_OPENCODE_MODEL);
  return DEFAULT_MODELS[agent];
}

/**
 * opencode selects providers via a `provider/model` string rather than a
 * flag or env var, so routing it through Bedrock means rewriting the model
 * string itself. Left alone if it already carries a provider prefix (an
 * explicit --model / EDS_AGENT_MODEL_OPENCODE value naming its own
 * provider), since resolveAgentModel only applies this to the bare default.
 */
function withBedrockProviderPrefix(model: string): string {
  return model.includes('/') ? model : `amazon-bedrock/${model}`;
}

/**
 * codex has no Bedrock env var; it requires `-c` config overrides
 * (`model_provider` + the Bedrock provider's region) passed as argv, per the
 * org's verified codex-bedrock-security-review setup. Region comes from the
 * environment's own AWS region var, falling back to us-east-1 — the region
 * gpt-5.6-luna's Bedrock endpoint requires — when neither is set.
 */
function codexBedrockConfigArgs(): string[] {
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || DEFAULT_CODEX_BEDROCK_REGION;
  return ['-c', 'model_provider=amazon-bedrock', '-c', `model_providers.amazon-bedrock.region=${region}`];
}

export type AgentDebugEvent = (name: string, payload?: Record<string, unknown>) => void;

export function buildArgs(
  agent: AgentName,
  prompt: string,
  model?: string,
  promptViaStdin = false,
  bedrock = false,
): string[] {
  // codex with no configured model resolves to undefined — omit --model
  // entirely so the CLI picks its own account-compatible default.
  const resolvedModel = resolveAgentModel(agent, model, bedrock);
  const modelArg = resolvedModel ? ['--model', resolvedModel] : [];
  // When the prompt is delivered on stdin, omit it from argv — a large prompt
  // as a command-line argument overflows ARG_MAX (spawn E2BIG). All four CLIs
  // read the prompt from stdin when it isn't passed positionally.
  const promptArg = promptViaStdin ? [] : [prompt];
  switch (agent) {
    case 'claude':
      return ['--print', ...modelArg, ...promptArg];
    case 'codex': {
      const bedrockArgs = bedrock ? codexBedrockConfigArgs() : [];
      // --dangerously-bypass-approvals-and-sandbox required for non-interactive use
      return ['exec', ...bedrockArgs, ...modelArg, '--dangerously-bypass-approvals-and-sandbox', ...promptArg];
    }
    case 'opencode':
      return ['run', ...modelArg, ...promptArg];
    case 'cursor':
      // cursor-agent uses --print for non-interactive stdout output
      return ['--print', ...modelArg, ...promptArg];
    case 'copilot': {
      // copilot's -p takes the prompt as its value — it MUST come immediately
      // after -p or the CLI rejects with "Invalid command format".
      // --allow-all-tools mirrors codex's sandbox bypass for non-interactive
      // use.
      //
      // Model handling is special: copilot's UI shows "Auto" as the default
      // pick, but the CLI rejects --model Auto ("not available"). Auto is a
      // UI-only label — internally, omitting --model IS Auto. So we only
      // pass --model when the user set an explicit override (via flag or
      // EDS_AGENT_MODEL_COPILOT); the sentinel string 'Auto' means "omit".
      //
      // Stdin fallback is unsupported: copilot -p requires an inline prompt
      // value, so promptViaStdin will fail here — callers must pass the
      // prompt inline for copilot.
      const copilotModel = resolveAgentModel('copilot', model);
      const copilotModelArg = !copilotModel || copilotModel === 'Auto' ? [] : ['--model', copilotModel];
      return ['-p', ...promptArg, ...copilotModelArg, '--allow-all-tools'];
    }
  }
}

export async function runAgent(options: {
  agent: AgentName;
  prompt: string;
  timeoutMs: number;
  model?: string;
  /** Apply the selected agent's Bedrock-routing env vars when enabled. */
  bedrock?: boolean;
  onOutput?: (chunk: string) => void;
  /**
   * Deliver the prompt on stdin instead of as an argv positional. Required for
   * large prompts (e.g. the composition resolver inlining candidate files),
   * which overflow ARG_MAX when passed as an argument.
   */
  promptViaStdin?: boolean;
  /** Optional debug-event sink; callers own how/where events get logged. */
  onDebugEvent?: AgentDebugEvent;
}): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent } = options;
  // Fall back to the process-wide EDS_BEDROCK signal (set once by the CLI's
  // top-level --bedrock resolution and inherited by every spawned subprocess)
  // when a call site doesn't pass `bedrock` explicitly — closes the gap for
  // call sites that forget to thread the flag through by hand.
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  const binary = resolveBinary(agent);
  const useStdin = !!promptViaStdin;
  const args = buildArgs(agent, prompt, model, useStdin, bedrock);

  const startedAt = Date.now();
  onDebugEvent?.('run.start', {
    agent,
    binary,
    model,
    bedrock: !!bedrock,
    timeoutMs,
    promptLen: prompt.length,
    promptHead: prompt.slice(0, 500),
  });

  return new Promise((resolve) => {
    const bedrockEnv = bedrock ? BEDROCK_ENV_BY_AGENT[agent] : undefined;
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(bedrockEnv ? { env: { ...process.env, ...bedrockEnv } } : {}),
    });
    if (useStdin && child.stdin) {
      // Guard against EPIPE: the child may close stdin before we finish
      // writing (fast exit, or it stops reading). Swallow the write error —
      // the child's own exit code/stderr is the source of truth.
      child.stdin.on('error', () => {});
      child.stdin.write(prompt, () => {
        child.stdin?.end();
      });
    } else {
      child.stdin?.end();
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const result = {
        exitCode: signal ? 1 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
      };
      onDebugEvent?.('run.end', {
        agent,
        model,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
        signal,
        timedOut,
        stdoutLen: stdout.length,
        stderrLen: stderr.length,
        stderrTail: stderr.slice(-1000),
      });
      resolve(result);
    });
  });
}

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';

export async function checkAgentAuth(agent: AgentName): Promise<AgentAuthStatus> {
  const binary = resolveBinary(agent);

  // Verify the selected agent's binary exists first — for EVERY agent, not
  // just claude. When `binary` is an absolute path (e.g. set via
  // EDS_AGENT_BINARY_<AGENT>=/opt/custom/bin), `which` on some shells doesn't
  // resolve it — check the filesystem directly for absolute paths, and fall
  // back to `which` for bare names on $PATH.
  const binaryExists = await new Promise<boolean>((resolve) => {
    if (binary.startsWith('/')) {
      import('node:fs/promises').then((fs) =>
        fs.access(binary).then(
          () => resolve(true),
          () => resolve(false),
        ),
      );
      return;
    }
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [binary], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
  });
  if (!binaryExists) return 'not-found';

  // Only Claude exposes `auth status --json`. Non-Claude agents are considered
  // authenticated once their binary is present — never gate them on claude
  // (e.g. Codex-via-Bedrock users would otherwise be blocked by a claude check).
  if (agent !== 'claude') return 'ok';

  // Use `claude auth status` — fast, no API call, works regardless of which
  // auth provider (direct, Bedrock, Vertex) or whether AWS_PROFILE is set.
  return new Promise((resolve) => {
    const child = spawn(binary, ['auth', 'status', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill('SIGTERM');
        resolve('unauthenticated');
      }
    }, 5000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve('unauthenticated');
        return;
      }
      try {
        const status = JSON.parse(stdout) as { loggedIn?: boolean };
        resolve(status.loggedIn ? 'ok' : 'unauthenticated');
      } catch {
        resolve('unauthenticated');
      }
    });
  });
}

/**
 * Build a diagnostic string from a failed agent run, surfacing the agent's own
 * stderr (or stdout, when stderr is empty) so callers never emit a context-free
 * "agent failed". Callers only invoke this on a failed run: either a non-zero
 * exit, or a zero exit that produced no tool calls. A non-zero exit is reported
 * as such; a zero exit is therefore the "produced no tool calls" case.
 */
export function describeAgentFailure(result: AgentRunResult, maxDetail = 800): string {
  const base = result.exitCode !== 0 ? `agent exited with code ${result.exitCode}` : 'agent produced no tool calls';
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-maxDetail).trim();
  return detail ? `${base} — ${detail}` : base;
}

export function extractSentinelOutput(stdout: string): string | null | 'multiple' {
  const START = '<<<EDS_OUTPUT_START>>>';
  const END = '<<<EDS_OUTPUT_END>>>';

  const startIdx = stdout.indexOf(START);
  const endIdx = stdout.indexOf(END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  // Check for multiple blocks
  const secondStart = stdout.indexOf(START, startIdx + START.length);
  if (secondStart !== -1 && secondStart < endIdx) return 'multiple';

  const afterStart = stdout.indexOf(END, startIdx);
  const secondEnd = stdout.indexOf(END, afterStart + END.length);
  if (secondEnd !== -1) return 'multiple';

  return stdout.slice(startIdx + START.length, endIdx).trim();
}
