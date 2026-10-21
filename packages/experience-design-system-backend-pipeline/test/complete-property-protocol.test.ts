import {
  normalizeClassificationCalls,
  accountClassificationCalls,
  jsonValueIssue,
} from '@contentful/experience-design-system-types';
import { generateCompleteDecisions } from '../src/steps/generation/src/services/property/complete-decisions.js';
import { expect, it } from 'vitest';
import { parseToolCalls } from '../src/agents/parsers/parse-tool-calls.js';

it('rejects malformed optional companions rather than accepting a truncated decision', () => {
  for (const companion of [{ required: 'yes' }, { description: 0 }, { reason: false }, { source_revision: 1 }]) {
    const parsed = parseToolCalls(
      JSON.stringify({
        tool: 'classify_prop',
        prop: 'a.b/λ',
        cdf_type: 'number',
        cdf_category: 'content',
        ...companion,
      }),
    );
    expect(parsed.calls).toEqual([]);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  }
});

it('requires a reasoned exclusion and preserves semantic decisions with no representation', () => {
  expect(parseToolCalls('{"tool":"exclude_prop","prop":"callback","reason":" "}').calls).toEqual([]);
  expect(
    parseToolCalls(
      '{"tool":"classify_prop","prop":"data","cdf_category":"content","reason":"No available representation"}',
    ).calls,
  ).toEqual([{ tool: 'classify_prop', prop: 'data', cdf_category: 'content', reason: 'No available representation' }]);
});

it('rejects trailing JSON content instead of accepting the first decision', () => {
  const parsed = parseToolCalls('{"tool":"classify_component"} {"tool":"classify_component"}');
  expect(parsed.calls).toEqual([]);
  expect(parsed.warnings.length).toBeGreaterThan(0);
});

it('rejects duplicate decoded own wire keys and descriptor-unsafe root arrays without invoking traps', () => {
  expect(
    parseToolCalls(
      '{"tool":"classify_prop","prop":"count","cdf_type":"number","cdf_category":"content","default":0,"default":1}',
    ).calls,
  ).toEqual([]);
  let traps = 0;
  const values = new Proxy([{ tool: 'classify_component' }], {
    get: () => {
      traps++;
      throw new Error('trap');
    },
    ownKeys: () => {
      traps++;
      throw new Error('trap');
    },
  });
  expect(normalizeClassificationCalls(values).calls).toEqual([]);
  expect(traps).toBe(0);
});

it('uses exact accounting for hidden inputs, duplicate calls, slot owners and empty components', () => {
  const inventory = {
    properties: ['__proto__', 'a.b/λ', 'callback'],
    slots: [{ name: 'region', sourceInput: 'children' }],
  };
  const calls = [
    { tool: 'classify_component' },
    ...inventory.properties.map((prop) => ({ tool: 'exclude_prop', prop, reason: 'Runtime-only input' })),
    { tool: 'classify_slot', slot: 'region', required: false },
  ];
  const parsed = normalizeClassificationCalls(calls);
  expect(accountClassificationCalls(inventory, parsed.calls).complete).toBe(true);
  expect(accountClassificationCalls(inventory, parsed.calls.slice(1)).missing).toContain('component');
  expect(normalizeClassificationCalls([...calls, calls[1]]).warnings.join(';')).toContain('Duplicate');
  expect(accountClassificationCalls({ properties: ['children'], slots: inventory.slots }, parsed.calls).complete).toBe(
    false,
  );
  expect(accountClassificationCalls({ properties: [], slots: [] }, [{ tool: 'classify_component' }]).complete).toBe(
    true,
  );
});

it('does not invoke diagnostic coercion, getters or proxy traps at the direct boundary', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'tool', {
    enumerable: true,
    get: () => {
      reads++;
      return 'classify_component';
    },
  });
  const proxy = new Proxy(
    { tool: 'classify_component' },
    {
      get: () => {
        reads++;
        throw new Error('trap');
      },
      ownKeys: () => {
        reads++;
        throw new Error('trap');
      },
    },
  );
  for (const value of [
    accessor,
    proxy,
    { tool: { toString: null, valueOf: null } },
    { tool: 'classify_prop', prop: 'count', cdf_type: 'number', cdf_category: 'content', default: NaN },
  ])
    expect(normalizeClassificationCalls([value]).calls).toEqual([]);
  expect(reads).toBe(0);
  const shared = { count: 0 };
  expect(jsonValueIssue([shared, shared])).toBeUndefined();
  expect(jsonValueIssue(Array(2))).toBeTruthy();
  const cycle: unknown[] = [];
  cycle.push(cycle);
  expect(jsonValueIssue(cycle)).toBeTruthy();
});

it('preserves accepted current-invocation calls and exact source in missing-only correction', async () => {
  const requests: Array<{ prompt: string; timeoutMs: number }> = [];
  const originalPrompt = 'Original source: callback: () => void; count: 0 | 1 = 0';
  const first =
    JSON.stringify({ tool: 'classify_component' }) +
    '\n' +
    JSON.stringify({ tool: 'classify_prop', prop: 'count', cdf_type: 'number', cdf_category: 'content', default: 0 });
  const second = JSON.stringify({ tool: 'exclude_prop', prop: 'callback', reason: 'Runtime callback' });
  const result = await generateCompleteDecisions({
    originalPrompt,
    inventory: { properties: ['count', 'callback'], slots: [] },
    timeoutMs: 1000,
    invoke: async (request) => {
      requests.push(request);
      return { stdout: requests.length === 1 ? first : second, stderr: '', exitCode: 0 };
    },
  });
  expect(result.complete).toBe(true);
  expect(result.calls).toHaveLength(3);
  expect(requests[1]!.prompt).toContain(originalPrompt);
  expect(requests[1]!.prompt).toContain('acceptedDecisions');
  expect(requests[1]!.prompt).toContain('previousResponse');
  expect(requests[1]!.timeoutMs).toBeLessThanOrEqual(requests[0]!.timeoutMs);
});

it('rejects exhausted, conflicting and cancelled correction without complete output', async () => {
  const inventory = { properties: ['count'], slots: [] };
  let now = 0;
  const exhausted = await generateCompleteDecisions({
    originalPrompt: 'source',
    inventory,
    timeoutMs: 10,
    now: () => now,
    invoke: async () => {
      now = 10;
      return { stdout: '{"tool":"classify_component"}', stderr: '', exitCode: 0 };
    },
  });
  expect(exhausted.complete).toBe(false);
  const conflicting = await generateCompleteDecisions({
    originalPrompt: 'source',
    inventory,
    timeoutMs: 1000,
    invoke: async () => ({ stdout: '{"tool":"classify_component"}', stderr: '', exitCode: 0 }),
  });
  expect(conflicting.complete).toBe(false);
  const abort = new AbortController();
  await expect(
    generateCompleteDecisions({
      originalPrompt: 'source',
      inventory,
      timeoutMs: 1000,
      signal: abort.signal,
      invoke: async () => {
        abort.abort();
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  ).rejects.toThrow();
});

it('enforces one deadline even when an injected invocation ignores cancellation', async () => {
  const started = performance.now();
  const outcome = await generateCompleteDecisions({
    originalPrompt: 'source',
    inventory: { properties: [], slots: [] },
    timeoutMs: 20,
    invoke: () => new Promise(() => undefined),
  });
  expect(outcome.complete).toBe(false);
  expect(outcome.diagnostics.join(';')).toContain('deadline');
  expect(performance.now() - started).toBeLessThan(500);
});
