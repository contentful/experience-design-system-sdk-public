import type { AgentName } from '../types/agent-name.js';
import type { AgentConversation, AgentNativeUsage, AgentRunResult } from '../types/agent-run.js';
import { decodeCodexConversationOutput } from './codex-conversation-output.js';
import { readNativeUsageSnapshot } from './agent-native-usage.js';
import { isRecord, isUuid } from './agent-event-values.js';

export function isAgentConversation(value: AgentConversation, agent: AgentName): boolean {
  return value.agent === agent && (agent === 'opencode' ? /^ses_[a-zA-Z0-9_-]+$/.test(value.id) : isUuid(value.id));
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
  const assistantMessages: string[] = [];
  const steps: string[] = [];
  let completed = false;
  let nativeUsage: AgentNativeUsage | undefined;
  let identityValid = true;
  const errors: string[] = [];
  const unparsed: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push(`Invalid ${agent} conversation event`);
      unparsed.push(line.trim());
      continue;
    }
    if (!isRecord(event)) {
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
      if (event.type === 'text' && isRecord(event.part) && typeof event.part.text === 'string') {
        if (!steps.length) steps.push('');
        steps[steps.length - 1] += event.part.text;
        completed = false;
      }
      if (event.type === 'step_start') {
        steps.push('');
        completed = false;
      }
      if (event.type === 'step_finish' && isRecord(event.part) && event.part.reason === 'stop') completed = true;
      if (event.type === 'error') {
        completed = false;
        errors.push(isRecord(event.error) ? JSON.stringify(event.error) : 'opencode conversation failed');
      }
    } else {
      if (event.type === 'assistant' && isRecord(event.message) && Array.isArray(event.message.content)) {
        const text = event.message.content
          .filter(
            (part): part is Record<string, unknown> =>
              isRecord(part) && part.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text)
          .join('\n');
        if (text) assistantMessages.push(text);
      }
      if (event.type === 'result') {
        completed = event.subtype === 'success' && event.is_error !== true;
        if (typeof event.result === 'string')
          message =
            agent === 'cursor' && assistantMessages.some((text) => text.trim())
              ? assistantMessages.join('\n')
              : event.result;
        if (!completed) errors.push(typeof event.result === 'string' ? event.result : `${agent} conversation failed`);
      }
    }
  }
  if (agent === 'opencode')
    message = steps
      .map((step) => step.replace(/\n+$/, ''))
      .filter((step) => step.trim())
      .join('\n');
  if (result.exitCode === 0 && !result.timedOut && (!conversation || !completed || !message.trim()))
    errors.push(`${agent} conversation did not return a completed final response`);
  return {
    ...result,
    exitCode: errors.length && result.exitCode === 0 ? 1 : result.exitCode,
    stdout: message,
    stderr: [result.stderr, ...new Set(errors), ...unparsed].filter(Boolean).join('\n'),
    ...(conversation ? { conversation } : {}),
    ...(identityValid && conversation && nativeUsage ? { nativeUsage } : {}),
  };
}
