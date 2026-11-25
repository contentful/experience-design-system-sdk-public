import type { AgentName } from '../types/agent-name.js';
import type { AgentNativeUsage } from '../types/agent-run.js';
import { isRecord } from './agent-event-values.js';

export function isNativeTransportEvent(agent: AgentName, value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (agent) {
    case 'codex':
      return [
        'thread.started',
        'turn.started',
        'item.started',
        'item.updated',
        'item.completed',
        'turn.completed',
        'turn.failed',
        'error',
      ].includes(value.type);
    case 'claude':
    case 'cursor':
      return ['system', 'assistant', 'user', 'result', 'stream_event'].includes(value.type);
    case 'opencode':
      return ['step_start', 'text', 'step_finish', 'error', 'tool_use', 'tool_result'].includes(value.type);
    case 'copilot':
      return false;
  }
}

export function readNativeUsageSnapshot(
  agent: AgentName,
  event: Record<string, unknown>,
): AgentNativeUsage | undefined {
  let source: AgentNativeUsage['source'];
  let scope: AgentNativeUsage['scope'];
  let usage: unknown;
  let keys: string[];
  if (agent === 'codex' && event.type === 'turn.completed') {
    source = 'codex.turn.completed.usage';
    scope = 'turn';
    usage = event.usage;
    keys = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
  } else if (agent === 'claude' && event.type === 'result') {
    source = 'claude.result.usage';
    scope = 'invocation';
    usage = event.usage;
    keys = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
  } else if (agent === 'opencode' && event.type === 'step_finish' && isRecord(event.part)) {
    source = 'opencode.step_finish.part.tokens';
    scope = 'step';
    usage = event.part.tokens;
    keys = ['input', 'output', 'reasoning'];
  } else {
    return undefined;
  }
  if (!isRecord(usage)) return undefined;
  const counters: Record<string, number> = {};
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) counters[key] = value;
  }
  if (
    agent === 'codex' &&
    counters.input_tokens !== undefined &&
    counters.cached_input_tokens !== undefined &&
    counters.cached_input_tokens > counters.input_tokens
  )
    return undefined;
  if (agent === 'opencode' && isRecord(usage.cache)) {
    for (const key of ['read', 'write']) {
      const value = usage.cache[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) counters[`cache.${key}`] = value;
    }
  }
  return Object.keys(counters).length ? { source, scope, counters } : undefined;
}
