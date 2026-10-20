import { describe, expect, it, vi } from 'vitest';
const invocation = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../src/agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({
    invoke: async ({ prompt }: { prompt: string }) => {
      invocation.prompts.push(prompt);
      return {
        stdout: [
          { tool: 'classify_prop', prop: 'title', cdf_type: 'string', cdf_category: 'content' },
          { tool: 'classify_slot', slot: 'body', allowed_components: ['Text'], required: true },
          { tool: 'classify_slot', slot: 'renderBody', allowed_components: ['Text'], required: true },
        ]
          .map((call) => JSON.stringify(call))
          .join('\n'),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    },
  }),
}));
import { generateCdfComponents } from '../../src/index.js';
import type { SlotDecision } from '@contentful/experience-design-system-types';
const component = {
  name: 'Panel',
  source: 'panel.tsx',
  framework: 'react' as const,
  props: [{ name: 'title', type: 'string', required: false }],
  slots: [
    { name: 'body', isDefault: false, allowedComponents: ['Text'] },
    { name: 'renderBody', isDefault: false, allowedComponents: ['Text'] },
  ],
};
const decision = (slot: string, state: SlotDecision['state']): SlotDecision => ({
  name: 'Panel',
  source: 'panel.tsx',
  slot,
  state,
  allowedComponents: [],
  required: false,
  evidence: [],
  coverage: 5,
  realVotes: 3,
});
describe('stateless accepted projection', () => {
  it.each(['open', 'finite'] as const)(
    'preserves an accepted prototype-named %s slot through generation',
    async (state) => {
      const result = await generateCdfComponents({
        components: [
          { ...component, slots: [{ name: '__proto__', isDefault: false, description: 'Nested content.' }] },
        ],
        acceptedSlots: [
          {
            ...decision('__proto__', state),
            description: 'Nested content.',
            allowedComponents: state === 'finite' ? ['Text'] : [],
          },
        ],
        skillContentOverride: 'Use supplied source.',
      } as Parameters<typeof generateCdfComponents>[0]);
      expect(result.failures).toEqual([]);
      const slots = result.components[0]?.$slots;
      expect(slots && Object.hasOwn(slots, '__proto__')).toBe(true);
      expect(slots?.['__proto__']).toEqual({
        $description: 'Nested content.',
        $required: false,
        ...(state === 'finite' ? { $allowedComponents: ['Text'] } : {}),
      });
      expect(invocation.prompts.at(-1)).toContain('"name":"__proto__"');
    },
  );

  it('suppresses false/unresolved raw candidates and clears stale restrictions on accepted open render callbacks', async () => {
    const lookup = vi.fn();
    const result = await generateCdfComponents({
      components: [component],
      agent: 'codex',
      acceptedSlots: [decision('body', 'unresolved'), decision('renderBody', 'open')],
      onCacheLookup: lookup,
      skillContentOverride: 'Use supplied source.',
    } as Parameters<typeof generateCdfComponents>[0]);
    expect(result.failures).toEqual([]);
    expect(result.components[0]?.$slots).toEqual({ renderBody: { $required: false } });
    expect(lookup).not.toHaveBeenCalled();
    expect(invocation.prompts.at(-1)).not.toContain('"allowedComponents":["Text"]');
  });
  it('does not invent an open slot when accepted decisions are empty', async () => {
    const result = await generateCdfComponents({
      components: [component],
      acceptedSlots: [],
      skillContentOverride: 'Use supplied source.',
    } as Parameters<typeof generateCdfComponents>[0]);
    expect(result.components[0]?.$slots).toBeUndefined();
  });
});
