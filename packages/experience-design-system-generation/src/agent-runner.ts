import type {
  ClassifyComponentCall,
  ClassifyPropCall,
  ClassifySlotCall,
  MapTokenPropCall,
  ParsedMapTokenPropToolCalls,
  ParsedSelectToolCalls,
  ParsedTokenToolCalls,
  ParsedToolCalls,
  RejectComponentCall,
  SelectComponentCall,
  SelectToolCall,
  SetGroupCall,
  SetTokenCall,
  TokenToolCall,
  ToolCall,
} from './generate/model/protocol.js';

export {
  agentSupportsBedrock,
  buildArgs,
  resolveAgentModel,
  resolveBinary,
} from './generate/services/agent-configuration-service.js';
export { checkAgentAuth } from './generate/services/agent-auth-service.js';
export { describeAgentFailure } from './generate/services/failure-diagnostics-service.js';
export { runAgent } from './generate/adapters/local/local-agent-process.js';

export { AGENT_NAMES, DEFAULT_AGENT_NAME, isAgentName } from './generate/model/agent.js';
export type { AgentName } from './generate/model/agent.js';
export type { AgentAuthStatus, AgentDebugEvent, AgentRunResult } from './generate/model/invocation.js';
export type {
  ClassifyComponentCall,
  ClassifyPropCall,
  ClassifySlotCall,
  ExcludePropCall,
  MapTokenPropCall,
  ParsedMapTokenPropToolCalls,
  ParsedSelectToolCalls,
  ParsedTokenToolCalls,
  ParsedToolCalls,
  RejectComponentCall,
  SelectComponentCall,
  SelectToolCall,
  SetGroupCall,
  SetTokenCall,
  TokenToolCall,
  ToolCall,
} from './generate/model/protocol.js';

// --- Tool call protocol ---

// --- Select tool calls ---

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
