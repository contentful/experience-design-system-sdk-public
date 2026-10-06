import { describe, expect, it, vi } from 'vitest';
import type { AgentInvoker, PromptOptions } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { createSelectionDebateDispatcher, parseDebateArgument } from '../src/debate-dispatch.js';
import type { TieredSelectionDisagreement } from '../src/selection-diff.js';

const component: RawComponentDefinition = {
  name: 'Card',
  source: 'src/Card.tsx',
  framework: 'react',
  props: [],
  slots: [],
};

const disagreement: TieredSelectionDisagreement = {
  id: 'd1',
  componentKey: 'Card::src/Card.tsx',
  field: 'decision',
  valuesByAgent: { 0: 'accepted', 1: 'rejected' },
  reasonsByAgent: { 0: 'visible UI', 1: 'wrapper' },
  tier: 'interpretive',
  tierReason: 'Requires judgment.',
};

describe('selection debate dispatch', () => {
  it('dispatches FOR and AGAINST concurrently with role-specific prompts and preserves evidence', async () => {
    const prompts: PromptOptions[] = [];
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondStarted!: () => void;
    const secondStartedGate = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const invoker: AgentInvoker = {
      invoke: vi.fn(async ({ prompt }) => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 2) secondStarted();
        await releaseGate;
        active -= 1;
        const role = prompt.includes('for') ? 'for' : 'against';
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            role,
            disagreement_id: 'd1',
            argument: `${role} argument`,
            evidence: [{ source: 'src/Card.tsx', line: '12', quote: '<Card />' }],
          }),
          stderr: '',
          timedOut: false,
        };
      }),
      checkAuth: vi.fn(),
    };
    const dispatch = createSelectionDebateDispatcher({
      invoker,
      agent: 'claude',
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: vi.fn(async (options) => {
        prompts.push(options);
        return `${options.debateRole} debate prompt`;
      }),
    });

    const resultPromise = dispatch(disagreement, component);
    await secondStartedGate;
    expect(calls).toBe(2);
    expect(maxActive).toBe(2);
    release();

    await expect(resultPromise).resolves.toMatchObject({
      disagreementId: 'd1',
      for: {
        role: 'for',
        argument: 'for argument',
        evidence: [{ source: 'src/Card.tsx', line: '12', quote: '<Card />' }],
      },
      against: { role: 'against', argument: 'against argument' },
    });
    expect(prompts.map(({ debateRole }) => debateRole).sort()).toEqual(['against', 'for']);
    expect(prompts.every(({ skill, disagreementInline }) => skill === 'debate-select' && disagreementInline)).toBe(
      true,
    );
  });

  it('rejects output that would silently lose the required evidence array', () => {
    expect(() =>
      parseDebateArgument(JSON.stringify({ role: 'for', disagreement_id: 'd1', argument: 'argument' }), 'for', 'd1'),
    ).toThrow('invalid evidence');
  });

  it('rejects a participant response for the wrong role or disagreement', () => {
    expect(() =>
      parseDebateArgument(
        JSON.stringify({ role: 'against', disagreement_id: 'other', argument: 'argument', evidence: [] }),
        'for',
        'd1',
      ),
    ).toThrow('wrong role or disagreement');
  });
});
