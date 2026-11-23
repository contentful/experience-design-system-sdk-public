import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalCliAgentInvoker } from '../../src/agents/invoker/create-local-cli-agent-invoker.js';
import { runAgent } from '../../src/agents/services/run-agent.js';
import { AGENT_NAMES, type AgentName } from '../../src/agents/types/agent-name.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:crypto', async () => ({
  ...(await vi.importActual<typeof import('node:crypto')>('node:crypto')),
  randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
}));

const uuid = '11111111-1111-4111-8111-111111111111';
const otherUuid = '22222222-2222-4222-8222-222222222222';
const idFor = (agent: AgentName) => (agent === 'opencode' ? 'ses_example' : uuid);
const eventsFor = (agent: AgentName, id: string, text?: string): string => {
  if (agent === 'copilot') return text ?? '';
  let events: unknown[];
  if (agent === 'codex') {
    events = [{ type: 'thread.started', thread_id: id }, { type: 'turn.started' }];
    if (text !== undefined)
      events.push({ type: 'item.completed', item: { type: 'agent_message', text } }, { type: 'turn.completed' });
  } else if (agent === 'opencode') {
    events = [{ type: 'step_start', sessionID: id, part: { type: 'step-start' } }];
    if (text !== undefined)
      events.push(
        { type: 'text', sessionID: id, part: { type: 'text', text } },
        { type: 'step_finish', sessionID: id, part: { type: 'step-finish', reason: 'stop' } },
      );
  } else {
    events = [{ type: 'system', subtype: 'init', session_id: id }];
    if (text !== undefined)
      events.push(
        { type: 'assistant', session_id: id, message: { content: [{ type: 'text', text }] } },
        { type: 'result', subtype: 'success', session_id: id, result: text, is_error: false },
      );
  }
  return events.map((event) => JSON.stringify(event)).join('\n');
};

describe('conversation continuation across agent providers', () => {
  const captures: Array<{ args: string[]; input: string }> = [];
  let outputs: Array<{ stdout: string; code?: number }>;

  beforeEach(() => {
    vi.stubEnv('EDS_BEDROCK', '0');
    captures.length = 0;
    outputs = [];
    vi.mocked(spawn)
      .mockReset()
      .mockImplementation((_command, args) => {
        const capture = { args: [...(args ?? [])], input: '' };
        captures.push(capture);
        const stdin = new PassThrough();
        stdin.on('data', (chunk: Buffer) => {
          capture.input += chunk.toString();
        });
        const child = Object.assign(new EventEmitter(), {
          stdin,
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: vi.fn(),
        });
        const output = outputs.shift()!;
        setImmediate(() => {
          child.stdout.end(output.stdout);
          child.stderr.end();
          child.emit('close', output.code ?? 0, null);
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['claude', ['--print', '--output-format', 'stream-json', '--verbose']],
    ['codex', ['exec', '--json']],
    ['cursor', ['--print', '--output-format', 'stream-json']],
    ['opencode', ['run', '--format', 'json']],
    ['copilot', ['-p', '--silent', '--session-id']],
  ] as const)('requests native event output from %s through the local invoker', async (agent, flags) => {
    outputs = [{ stdout: eventsFor(agent, idFor(agent), 'answer') }];
    const result = await createLocalCliAgentInvoker().invoke({ agent, prompt: 'task', timeoutMs: 0 });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'answer' });
    for (const flag of flags) expect(captures[0].args).toContain(flag);
  });

  it.each(AGENT_NAMES)('retains %s identity when its process exits before a final response', async (agent) => {
    const id = idFor(agent);
    outputs = [{ stdout: eventsFor(agent, id), code: 1 }];
    const result = await createLocalCliAgentInvoker().invoke({ agent, prompt: 'task', timeoutMs: 0 });
    expect(result.exitCode).toBe(1);
    expect(result.conversation).toEqual({ agent, id });
    outputs = [{ stdout: eventsFor(agent, id, 'repaired') }];
    const repaired = await createLocalCliAgentInvoker().invoke({
      agent,
      prompt: 'repair',
      timeoutMs: 0,
      conversation: result.conversation,
    });
    expect(repaired).toMatchObject({ exitCode: 0, stdout: 'repaired', conversation: { agent, id } });
    expect(captures[1].args).toContain(agent === 'copilot' ? `--resume=${id}` : id);
  });

  it.each(AGENT_NAMES.filter((agent) => agent !== 'copilot'))(
    'rejects a changed native conversation from %s',
    async (agent) => {
      const id = idFor(agent);
      const otherId = agent === 'opencode' ? 'ses_other' : otherUuid;
      outputs = [{ stdout: eventsFor(agent, otherId, 'unrelated answer') }];
      const result = await runAgent({ agent, prompt: 'repair', timeoutMs: 0, conversation: { agent, id } });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/different conversation/i);
      expect(result.conversation).toEqual({ agent, id });
    },
  );

  it.each(AGENT_NAMES)('rejects missing completion metadata from %s', async (agent) => {
    outputs = [{ stdout: eventsFor(agent, idFor(agent)) }];
    const result = await createLocalCliAgentInvoker().invoke({ agent, prompt: 'task', timeoutMs: 0 });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('rejects a foreign provider identity before spawning a process', async () => {
    await expect(
      runAgent({ agent: 'claude', prompt: 'task', timeoutMs: 0, conversation: { agent: 'codex', id: uuid } }),
    ).rejects.toThrow(/conversation identity/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('creates Copilot with a host-owned exact ID and resumes that ID explicitly', async () => {
    outputs = [{ stdout: 'draft' }, { stdout: 'final' }];
    const invoker = createLocalCliAgentInvoker();
    const first = await invoker.invoke({ agent: 'copilot', prompt: 'task', timeoutMs: 0 });
    await invoker.invoke({ agent: 'copilot', prompt: 'repair', timeoutMs: 0, conversation: first.conversation });
    expect(captures[0].args).toContain('--session-id');
    expect(captures[0].args).toContain(uuid);
    expect(captures[1].args).toContain(`--resume=${uuid}`);
    expect(captures[1].args).not.toContain('--session-id');
    expect(captures[0].args).toContain('--silent');
  });
});
