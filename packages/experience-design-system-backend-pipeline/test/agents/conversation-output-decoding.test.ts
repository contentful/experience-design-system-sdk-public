import { describe, expect, it } from 'vitest';
import { decodeAgentConversationOutput } from '../../src/agents/helpers/agent-conversation-output.js';
import { parseMapTokenPropToolCalls } from '../../src/agents/parsers/parse-map-token-prop-tool-calls.js';
import { parseSelectToolCalls } from '../../src/agents/parsers/parse-select-tool-calls.js';
import { parseTokenToolCalls } from '../../src/agents/parsers/parse-token-tool-calls.js';
import { parseToolCalls } from '../../src/agents/parsers/parse-tool-calls.js';
import { AGENT_NAMES, type AgentName } from '../../src/agents/types/agent-name.js';
import type { AgentRunResult } from '../../src/agents/types/agent-run.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const idFor = (agent: AgentName) => (agent === 'opencode' ? 'ses_example' : uuid);

const plainText = [
  'Reviewing the components.',
  '{"tool":"select_component","name":"Button","reason":"reusable","confidence":4}',
  '{"tool":"reject_component","name":"Layout","reason":"page shell"}',
  '{"tool":"classify_component","name":"Button","description":"A button"}',
  '{"tool":"classify_prop","component":"Button","prop":"label","type":"string","category":"content"}',
  '{"tool":"set_token","path":"color.primary","type":"color","value":"#000"}',
  '{"tool":"map_token_prop","component":"Button","prop":"color","token":"color.primary"}',
  'Done.',
].join('\n');

const line = (event: unknown) => JSON.stringify(event);

const completedStream = (agent: AgentName, text: string): string => {
  const id = idFor(agent);
  switch (agent) {
    case 'copilot':
      return text;
    case 'codex':
      return [
        line({ type: 'thread.started', thread_id: id }),
        line({ type: 'turn.started' }),
        line({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } }),
        line({ type: 'item.completed', item: { type: 'agent_message', text } }),
        line({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }),
      ].join('\n');
    case 'opencode':
      return [
        line({ type: 'step_start', sessionID: id, part: { type: 'step-start' } }),
        line({ type: 'text', sessionID: id, part: { type: 'text', text } }),
        line({ type: 'step_finish', sessionID: id, part: { type: 'step-finish', reason: 'stop' } }),
      ].join('\n');
    case 'claude':
    case 'cursor':
      return [
        line({ type: 'system', subtype: 'init', session_id: id }),
        line({ type: 'assistant', session_id: id, message: { content: [{ type: 'text', text }] } }),
        line({ type: 'result', subtype: 'success', session_id: id, result: text, is_error: false }),
      ].join('\n');
  }
};

const run = (stdout: string, overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  timedOut: false,
  ...overrides,
});

describe('decoded conversation output matches plain output for every caller parser', () => {
  it.each(AGENT_NAMES)('%s final text parses to the same tool calls as plain output', (agent) => {
    const decoded = decodeAgentConversationOutput(agent, run(completedStream(agent, plainText)));
    expect(decoded.exitCode).toBe(0);
    expect(decoded.stdout).toBe(plainText);
    expect(decoded.conversation).toEqual(agent === 'copilot' ? undefined : { agent, id: idFor(agent) });
    expect(parseSelectToolCalls(decoded.stdout)).toEqual(parseSelectToolCalls(plainText));
    expect(parseToolCalls(decoded.stdout)).toEqual(parseToolCalls(plainText));
    expect(parseTokenToolCalls(decoded.stdout)).toEqual(parseTokenToolCalls(plainText));
    expect(parseMapTokenPropToolCalls(decoded.stdout)).toEqual(parseMapTokenPropToolCalls(plainText));
    expect(parseSelectToolCalls(decoded.stdout).calls).toHaveLength(2);
  });

  it.each(AGENT_NAMES)('%s keeps a nonzero exit code and the native stderr', (agent) => {
    const decoded = decodeAgentConversationOutput(agent, run('', { exitCode: 2, stderr: 'native failure' }));
    expect(decoded.exitCode).toBe(2);
    expect(decoded.stderr.split('\n')[0]).toBe('native failure');
    expect(decoded.timedOut).toBe(false);
  });

  it.each(AGENT_NAMES)('%s keeps a timeout as a timeout', (agent) => {
    const decoded = decodeAgentConversationOutput(agent, run('', { exitCode: 1, timedOut: true }));
    expect(decoded).toMatchObject({ exitCode: 1, timedOut: true });
  });

  it.each(AGENT_NAMES)('%s turns an empty successful exit into a failure with a reason', (agent) => {
    const decoded = decodeAgentConversationOutput(agent, run(''));
    expect(decoded.exitCode).toBe(1);
    expect(decoded.stdout).toBe('');
    expect(decoded.stderr).toMatch(/did not return/i);
  });

  it.each(AGENT_NAMES.filter((agent) => agent !== 'copilot'))(
    '%s rejects a partial stream that ends before completion',
    (agent) => {
      const partial = completedStream(agent, plainText).split('\n').slice(0, -1).join('\n');
      const decoded = decodeAgentConversationOutput(agent, run(partial));
      expect(decoded.exitCode).toBe(1);
      expect(decoded.stderr).toMatch(/did not return a completed final response/i);
    },
  );

  it.each(AGENT_NAMES.filter((agent) => agent !== 'copilot'))(
    '%s keeps non-JSON stdout lines in the failure diagnostic',
    (agent) => {
      const decoded = decodeAgentConversationOutput(agent, run('Error: not logged in', { exitCode: 1 }));
      expect(decoded.exitCode).toBe(1);
      expect(decoded.stdout).toBe('');
      expect(decoded.stderr).toMatch(/Invalid .* conversation event/i);
      expect(decoded.stderr.split('\n').at(-1)).toBe('Error: not logged in');
    },
  );

  it.each(AGENT_NAMES.filter((agent) => agent !== 'copilot'))(
    '%s fails a successful exit that mixes non-JSON lines into the event stream',
    (agent) => {
      const decoded = decodeAgentConversationOutput(agent, run(`warning: plain text\n${completedStream(agent, 'ok')}`));
      expect(decoded.exitCode).toBe(1);
      expect(decoded.stdout).toBe('ok');
      expect(decoded.stderr.split('\n').at(-1)).toBe('warning: plain text');
    },
  );

  it('passes Copilot plain output through unchanged', () => {
    const decoded = decodeAgentConversationOutput('copilot', run(`${plainText}\n`, { stderr: 'note' }));
    expect(decoded).toMatchObject({ exitCode: 0, stdout: `${plainText}\n`, stderr: 'note' });
  });

  it('reports a Claude error result as a failure with its message', () => {
    const stdout = [
      line({ type: 'system', subtype: 'init', session_id: uuid }),
      line({
        type: 'result',
        subtype: 'error_during_execution',
        session_id: uuid,
        result: 'Invalid API key',
        is_error: true,
      }),
    ].join('\n');
    const decoded = decodeAgentConversationOutput('claude', run(stdout));
    expect(decoded.exitCode).toBe(1);
    expect(decoded.stderr).toContain('Invalid API key');
  });

  it('uses the last Cursor assistant message when present, otherwise the result text', () => {
    const withAssistant = [
      line({ type: 'system', subtype: 'init', session_id: uuid }),
      line({ type: 'assistant', session_id: uuid, message: { content: [{ type: 'text', text: 'final' }] } }),
      line({ type: 'result', subtype: 'success', session_id: uuid, result: 'earlier\nfinal', is_error: false }),
    ].join('\n');
    expect(decodeAgentConversationOutput('cursor', run(withAssistant)).stdout).toBe('final');
    const resultOnly = [
      line({ type: 'system', subtype: 'init', session_id: uuid }),
      line({ type: 'result', subtype: 'success', session_id: uuid, result: 'final', is_error: false }),
    ].join('\n');
    expect(decodeAgentConversationOutput('cursor', run(resultOnly)).stdout).toBe('final');
  });

  it('keeps only the last OpenCode step text as the final response', () => {
    const stdout = [
      line({ type: 'step_start', sessionID: 'ses_example', part: { type: 'step-start' } }),
      line({ type: 'text', sessionID: 'ses_example', part: { type: 'text', text: 'first step' } }),
      line({ type: 'step_finish', sessionID: 'ses_example', part: { type: 'step-finish', reason: 'tool-calls' } }),
      line({ type: 'step_start', sessionID: 'ses_example', part: { type: 'step-start' } }),
      line({ type: 'text', sessionID: 'ses_example', part: { type: 'text', text: 'final ' } }),
      line({ type: 'text', sessionID: 'ses_example', part: { type: 'text', text: 'answer' } }),
      line({ type: 'step_finish', sessionID: 'ses_example', part: { type: 'step-finish', reason: 'stop' } }),
    ].join('\n');
    expect(decodeAgentConversationOutput('opencode', run(stdout))).toMatchObject({
      exitCode: 0,
      stdout: 'final answer',
    });
  });

  it('keeps only the last Codex agent message of the final turn', () => {
    const stdout = [
      line({ type: 'thread.started', thread_id: uuid }),
      line({ type: 'turn.started' }),
      line({ type: 'item.completed', item: { type: 'agent_message', text: 'progress note' } }),
      line({ type: 'item.completed', item: { type: 'agent_message', text: 'final' } }),
      line({ type: 'turn.completed' }),
    ].join('\n');
    expect(decodeAgentConversationOutput('codex', run(stdout))).toMatchObject({ exitCode: 0, stdout: 'final' });
  });
});
