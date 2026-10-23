import type { AgentConversation, AgentRunResult } from '../types/agent-run.js';

const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isCodexConversation(value: AgentConversation): boolean {
  return value.agent === 'codex' && sessionId.test(value.id);
}

/** Transport events never enter the stage's response parser as if they were agent decisions. */
export function decodeCodexConversationOutput(result: AgentRunResult, previous?: AgentConversation): AgentRunResult {
  let conversation = previous;
  let message = '';
  let completed = false;
  const errors: string[] = [];
  const turnErrors: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push('Invalid Codex conversation event');
      continue;
    }
    if (!record(event)) {
      errors.push('Invalid Codex conversation event');
      continue;
    }
    if (event.type === 'thread.started') {
      if (typeof event.thread_id !== 'string' || !sessionId.test(event.thread_id)) {
        errors.push('Codex returned an invalid conversation identity');
      } else if (conversation && conversation.id !== event.thread_id) {
        errors.push('Codex resumed a different conversation');
      } else {
        conversation = { agent: 'codex', id: event.thread_id };
      }
    }
    if (event.type === 'turn.started') {
      message = '';
      completed = false;
      turnErrors.length = 0;
    }
    if (event.type === 'item.completed' && record(event.item) && event.item.type === 'agent_message') {
      if (typeof event.item.text === 'string') message = event.item.text;
    }
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'turn.failed') {
      completed = false;
      turnErrors.push(
        record(event.error) && typeof event.error.message === 'string' ? event.error.message : 'Codex turn failed',
      );
    }
    if (event.type === 'error')
      turnErrors.push(typeof event.message === 'string' ? event.message : 'Codex conversation failed');
  }
  if (result.exitCode === 0 && !result.timedOut && (!conversation || !completed || !message.trim()))
    errors.push('Codex conversation did not return a completed final response');
  return {
    ...result,
    exitCode: (errors.length || (!completed && turnErrors.length)) && result.exitCode === 0 ? 1 : result.exitCode,
    stdout: message,
    stderr: [result.stderr, ...new Set([...errors, ...turnErrors])].filter(Boolean).join('\n'),
    ...(conversation ? { conversation } : {}),
  };
}
