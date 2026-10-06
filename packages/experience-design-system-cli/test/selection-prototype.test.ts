import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentInvoker } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { runSelectionPrototype } from '../src/api/selection-prototype.js';

const component: RawComponentDefinition = {
  name: 'Card',
  source: '/components/Card.tsx',
  framework: 'react',
  props: [],
  slots: [],
};

const archive = { root: join(tmpdir(), 'cli-v2-selection-prototype-tests') };

describe('selection prototype', () => {
  it('runs binary selection through broadcast, debate, determination, and assembly', async () => {
    let invocation = 0;
    const invoker: AgentInvoker = {
      invoke: vi.fn(async () => {
        const decision = invocation++ === 0 ? 'select_component' : 'reject_component';
        return {
          exitCode: 0,
          stdout: JSON.stringify({ tool: decision, name: 'Card', reason: 'agent judgment' }),
          stderr: '',
          timedOut: false,
        };
      }),
      checkAuth: vi.fn(),
    };

    const result = await runSelectionPrototype({
      components: [component],
      agentCount: 2,
      invoker,
      agent: 'claude',
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: async () => 'selection prompt',
      verifyFactual: async () => ({ disagreementId: 'unused' }),
      archive,
      debateInterpretive: async (disagreement) => ({
        disagreementId: disagreement.id,
        decision: 'accepted',
        reason: 'debate resolved the judgment',
      }),
    });

    expect(invoker.invoke).toHaveBeenCalledTimes(2);
    expect(result.pipeline.tieredDisagreements[0].tier).toBe('interpretive');
    expect(result.assembly.selections).toEqual([
      {
        componentKey: 'Card::/components/Card.tsx',
        decision: 'accepted',
        reason: 'debate resolved the judgment',
        source: 'debate',
      },
    ]);
    expect(result.review[0]).toMatchObject({ id: 'd1', status: 'resolved' });
  });

  it('automatically dispatches the debate pair when no debate callback is supplied', async () => {
    let selectionInvocation = 0;
    const invoker: AgentInvoker = {
      invoke: vi.fn(async ({ prompt }) => {
        if (prompt.startsWith('selection')) {
          const decision = selectionInvocation++ === 0 ? 'select_component' : 'reject_component';
          return {
            exitCode: 0,
            stdout: JSON.stringify({ tool: decision, name: 'Card', reason: 'agent judgment' }),
            stderr: '',
            timedOut: false,
          };
        }
        const role = prompt.includes('debate-for') ? 'for' : 'against';
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            role,
            disagreement_id: 'd1',
            argument: `${role} argument`,
            evidence: [],
          }),
          stderr: '',
          timedOut: false,
        };
      }),
      checkAuth: vi.fn(),
    };

    const result = await runSelectionPrototype({
      components: [component],
      agentCount: 2,
      invoker,
      agent: 'claude',
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: async (options) =>
        options.skill === 'debate-select' ? `debate-${options.debateRole}` : 'selection',
      verifyFactual: async () => ({ disagreementId: 'unused' }),
      archive,
    });

    expect(invoker.invoke).toHaveBeenCalledTimes(4);
    expect(result.pipeline.debateTranscripts[0]).toMatchObject({
      disagreementId: 'd1',
      for: { role: 'for', argument: 'for argument' },
      against: { role: 'against', argument: 'against argument' },
    });
    expect(result.review[0]).toMatchObject({ id: 'd1', status: 'pending', debate: { disagreementId: 'd1' } });
  });
});
