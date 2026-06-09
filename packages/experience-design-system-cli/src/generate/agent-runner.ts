import { spawn } from 'node:child_process';

export type AgentName = 'claude' | 'codex' | 'opencode' | 'cursor';

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
}

export interface ExcludePropCall {
  tool: 'exclude_prop';
  prop: string;
  reason: string;
}

export interface ClassifyComponentCall {
  tool: 'classify_component';
  description?: string;
}

export interface ClassifySlotCall {
  tool: 'classify_slot';
  slot: string;
  required?: boolean;
  allowed_components?: string[];
  description?: string;
}

export type ToolCall = ClassifyPropCall | ExcludePropCall | ClassifyComponentCall | ClassifySlotCall;

// --- Select tool calls ---

export interface SelectComponentCall {
  tool: 'select_component';
  name: string;
  reason?: string;
  confidence?: number; // 0–100, agent's certainty this belongs in ExO
}

export interface RejectComponentCall {
  tool: 'reject_component';
  name: string;
  reason?: string;
  confidence?: number; // 0–100, agent's certainty this should be excluded
}

export type SelectToolCall = SelectComponentCall | RejectComponentCall;

export interface ParsedSelectToolCalls {
  calls: SelectToolCall[];
  warnings: string[];
}

const VALID_SELECT_TOOL_NAMES = new Set(['select_component', 'reject_component']);

export function parseSelectToolCallLines(stdout: string): ParsedSelectToolCalls {
  const calls: SelectToolCall[] = [];
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
    if (typeof rec.confidence === 'number' && rec.confidence >= 0 && rec.confidence <= 100) {
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
      calls.push(call);
    }
  }

  return { calls, warnings };
}

export function parseTokenToolCallLines(stdout: string): ParsedTokenToolCalls {
  const calls: TokenToolCall[] = [];
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

// --- Agent invocation ---

const AGENT_BINARIES: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
};

// Default to small/fast models for single-component classification — cheap and accurate enough.
const DEFAULT_MODELS: Record<AgentName, string> = {
  claude: 'haiku',
  codex: 'gpt-4.1-nano', // requires OPENAI_API_KEY; ChatGPT account users must pass --model
  opencode: 'claude-haiku-4-5',
  cursor: 'claude-3-5-haiku-20241022',
};

export function resolveBinary(agent: AgentName): string {
  return AGENT_BINARIES[agent];
}

function buildArgs(agent: AgentName, prompt: string, model?: string): string[] {
  const m = model ?? DEFAULT_MODELS[agent];
  switch (agent) {
    case 'claude':
      return ['--print', '--model', m, prompt];
    case 'codex':
      // --dangerously-bypass-approvals-and-sandbox required for non-interactive use
      return ['exec', '--model', m, '--dangerously-bypass-approvals-and-sandbox', prompt];
    case 'opencode':
      return ['run', '--model', m, prompt];
    case 'cursor':
      // cursor-agent uses --print for non-interactive stdout output
      return ['--print', '--model', m, prompt];
  }
}

export async function runAgent(options: {
  agent: AgentName;
  prompt: string;
  interactive: boolean;
  timeoutMs: number;
  model?: string;
  onOutput?: (chunk: string) => void;
}): Promise<AgentRunResult> {
  const { agent, prompt, interactive, timeoutMs, model, onOutput } = options;

  const binary = resolveBinary(agent);
  const args = buildArgs(agent, prompt, model);

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    if (!interactive) {
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onOutput?.(text);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: signal ? 1 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';

export async function checkAgentAuth(agent: AgentName): Promise<AgentAuthStatus> {
  if (agent !== 'claude') return 'ok';

  const binary = resolveBinary(agent);

  // Verify the binary exists first
  const whichResult = await new Promise<number>((resolve) => {
    const child = spawn('which', [binary], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (whichResult !== 0) return 'not-found';

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
