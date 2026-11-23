import type { AgentName } from '../types/agent-name.js';
import type { AgentConversation, AgentNativeUsage, AgentRunResult } from '../types/agent-run.js';
import { decodeCodexConversationOutput } from './codex-conversation-output.js';
import { readNativeUsageSnapshot } from './agent-native-usage.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isAgentConversation(value: AgentConversation, agent: AgentName): boolean {
  return value.agent === agent && (agent === 'opencode' ? /^ses_[a-zA-Z0-9_-]+$/.test(value.id) : uuid.test(value.id));
}

export function decodeAgentConversationOutput(
  agent: AgentName,
  result: AgentRunResult,
  previous?: AgentConversation,
): AgentRunResult {
  if (agent === 'codex') return decodeCodexConversationOutput(result, previous);
  if (agent === 'copilot') {
    const missing = result.exitCode === 0 && !result.timedOut && !result.stdout.trim();
    return {
      ...result,
      exitCode: missing ? 1 : result.exitCode,
      stderr: [result.stderr, ...(missing ? ['Copilot conversation did not return a final response'] : [])]
        .filter(Boolean)
        .join('\n'),
      ...(previous ? { conversation: previous } : {}),
    };
  }
  let conversation = previous;
  let message = '';
  let assistantMessage = '';
  let completed = false;
  let nativeUsage: AgentNativeUsage | undefined;
  let identityValid = true;
  const errors: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push(`Invalid ${agent} conversation event`);
      continue;
    }
    if (!record(event)) {
      errors.push(`Invalid ${agent} conversation event`);
      continue;
    }
    const id = agent === 'opencode' ? event.sessionID : event.session_id;
    if (id !== undefined) {
      if (typeof id !== 'string' || !isAgentConversation({ agent, id }, agent)) {
        identityValid = false;
        errors.push(`${agent} returned an invalid conversation identity`);
      } else if (conversation && conversation.id !== id) {
        identityValid = false;
        errors.push(`${agent} resumed a different conversation`);
      } else {
        conversation = { agent, id };
      }
    }
    if (event.type === 'step_finish' || event.type === 'result') nativeUsage = readNativeUsageSnapshot(agent, event);
    if (agent === 'opencode') {
      if (event.type === 'text' && record(event.part) && typeof event.part.text === 'string') {
        message += event.part.text;
        completed = false;
      }
      if (event.type === 'step_start') {
        message = '';
        completed = false;
      }
      if (event.type === 'step_finish' && record(event.part) && event.part.reason === 'stop') completed = true;
      if (event.type === 'error') {
        completed = false;
        errors.push(record(event.error) ? JSON.stringify(event.error) : 'opencode conversation failed');
      }
    } else {
      if (event.type === 'assistant' && record(event.message) && Array.isArray(event.message.content)) {
        assistantMessage = event.message.content
          .filter(
            (part): part is Record<string, unknown> =>
              record(part) && part.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text)
          .join('\n');
      }
      if (event.type === 'result') {
        completed = event.subtype === 'success' && event.is_error !== true;
        if (typeof event.result === 'string')
          message = agent === 'cursor' && assistantMessage.trim() ? assistantMessage : event.result;
        if (!completed) errors.push(typeof event.result === 'string' ? event.result : `${agent} conversation failed`);
      }
    }
  }
  if (result.exitCode === 0 && !result.timedOut && (!conversation || !completed || !message.trim()))
    errors.push(`${agent} conversation did not return a completed final response`);
  return {
    ...result,
    exitCode: errors.length && result.exitCode === 0 ? 1 : result.exitCode,
    stdout: message,
    stderr: [result.stderr, ...new Set(errors)].filter(Boolean).join('\n'),
    ...(conversation ? { conversation } : {}),
    ...(identityValid && conversation && nativeUsage ? { nativeUsage } : {}),
  };
}
