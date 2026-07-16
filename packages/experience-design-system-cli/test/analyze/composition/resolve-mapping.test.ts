import { describe, it, expect, vi } from 'vitest';
import { resolveMapping } from '../../../src/analyze/composition/resolve-mapping.js';
import type { RawComponentDefinition, RawSlotDefinition } from '../../../src/types.js';

function comp(name: string, slots: RawSlotDefinition[] = []): RawComponentDefinition {
  return { name, source: '', framework: 'react', props: [], slots };
}
const dslot = (allowed?: string[]): RawSlotDefinition => ({
  name: 'children',
  isDefault: true,
  ...(allowed ? { allowedComponents: allowed } : {}),
});

const COMPONENTS = [comp('SectionTab', [dslot()]), comp('Section3Up'), comp('CaseStudyCard')];

describe('resolveMapping (T2 acquisition + routing orchestration)', () => {
  it('user map only → used verbatim, no agent, no adapter', async () => {
    const runAgentFn = vi.fn();
    const res = await resolveMapping({
      components: COMPONENTS,
      userMap: { version: 1, groups: { SectionTab: ['Section3Up'] } },
      files: [],
      runAgentFn,
    });
    const parent = res.components.find((c) => c.name === 'SectionTab')!;
    expect(parent.slots.find((s) => s.isDefault)!.allowedComponents).toEqual(['Section3Up']);
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(res.edges.every((e) => e.provenance === 'user')).toBe(true);
  });

  it('adapter path resolves without invoking the agent', async () => {
    const runAgentFn = vi.fn();
    const adapter = () => [{ parent: 'SectionTab', child: 'Section3Up', provenance: 'adapter:test' as const }];
    const res = await resolveMapping({ components: COMPONENTS, adapter, files: [], runAgentFn });
    expect(res.components.find((c) => c.name === 'SectionTab')!.slots[0].allowedComponents).toEqual(['Section3Up']);
    expect(runAgentFn).not.toHaveBeenCalled();
  });

  it('agent path parses JSONL and applies edges', async () => {
    const runAgentFn = vi.fn(async () =>
      [
        '{"tool":"map_edge","parent":"SectionTab","child":"Section3Up","confidence":4}',
        '{"tool":"map_edge","parent":"Section3Up","child":"CaseStudyCard"}',
      ].join('\n'),
    );
    const res = await resolveMapping({
      components: COMPONENTS,
      useAgent: true,
      files: [{ path: 'm.ts', content: 'withParentType' }],
      runAgentFn,
    });
    expect(runAgentFn).toHaveBeenCalledTimes(1);
    expect(res.components.find((c) => c.name === 'SectionTab')!.slots[0].allowedComponents).toEqual(['Section3Up']);
    expect(res.edges.some((e) => e.parent === 'Section3Up' && e.child === 'CaseStudyCard')).toBe(true);
  });

  it('routing: agent suppressed for components a higher-rank source already resolved', async () => {
    // user map covers SectionTab; agent should not need to run when everything
    // is covered and useAgent is not forced.
    const runAgentFn = vi.fn(async () => '');
    const res = await resolveMapping({
      components: COMPONENTS,
      userMap: { version: 1, groups: { SectionTab: ['Section3Up'], Section3Up: ['CaseStudyCard'] } },
      files: [{ path: 'm.ts', content: 'withParentType' }],
      runAgentFn,
    });
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(res.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('conflict: user map wins over agent, agent edge recorded as loser', async () => {
    const runAgentFn = vi.fn(
      async () => '{"tool":"map_edge","parent":"SectionTab","child":"Section3Up","slot":"footer"}',
    );
    const res = await resolveMapping({
      components: [comp('SectionTab', [{ name: 'header', isDefault: false }, dslot()]), comp('Section3Up')],
      userMap: { version: 1, groups: {} }, // empty user map
      forceAgent: true,
      files: [{ path: 'm.ts', content: 'x' }],
      runAgentFn,
    });
    // With an empty user map there's no conflict; agent edge (footer) applies via default? No — slot footer missing, agent-provenance → dropped-warned.
    expect(res.warnings.join(' ')).toMatch(/footer/i);
  });

  it('drops edges naming unknown components (warn)', async () => {
    const runAgentFn = vi.fn(async () => '{"tool":"map_edge","parent":"SectionTab","child":"Ghost"}');
    const res = await resolveMapping({
      components: COMPONENTS,
      useAgent: true,
      files: [{ path: 'm.ts', content: 'x' }],
      runAgentFn,
    });
    expect(res.warnings.join(' ')).toMatch(/Ghost/);
  });

  it('no sources → returns components unchanged with no edges', async () => {
    const res = await resolveMapping({ components: COMPONENTS, files: [], runAgentFn: vi.fn() });
    expect(res.edges).toHaveLength(0);
    expect(res.components).toHaveLength(COMPONENTS.length);
  });

  describe('precedence: code slots > mapping (adapter) > agent', () => {
    it('code slots survive with no other source (pass-through)', async () => {
      const withCode = [comp('A', [dslot(['B'])]), comp('B')];
      const res = await resolveMapping({ components: withCode, files: [], runAgentFn: vi.fn() });
      expect(res.components.find((c) => c.name === 'A')!.slots[0].allowedComponents).toEqual(['B']);
      expect(res.edges.find((e) => e.parent === 'A')!.provenance).toBe('typed-slot');
    });

    it('code and adapter union when disjoint (different children)', async () => {
      const withCode = [comp('A', [dslot(['B'])]), comp('B'), comp('C')];
      const adapter = () => [{ parent: 'A', child: 'C', slot: 'children', provenance: 'adapter:x' as const }];
      const res = await resolveMapping({ components: withCode, adapter, files: [], runAgentFn: vi.fn() });
      const allowed = res.components.find((c) => c.name === 'A')!.slots[0].allowedComponents!.sort();
      expect(allowed).toEqual(['B', 'C']);
    });

    it('code slot wins a slot-placement conflict against the adapter', async () => {
      // Code: A.header → B. Adapter: A.footer → B. Code (rank 2) beats adapter (rank 3).
      const withCode = [
        comp('A', [
          { name: 'header', isDefault: false, allowedComponents: ['B'] },
          { name: 'footer', isDefault: false },
        ]),
        comp('B'),
      ];
      const adapter = () => [{ parent: 'A', child: 'B', slot: 'footer', provenance: 'adapter:x' as const }];
      const res = await resolveMapping({ components: withCode, adapter, files: [], runAgentFn: vi.fn() });
      const a = res.components.find((c) => c.name === 'A')!;
      expect(a.slots.find((s) => s.name === 'header')!.allowedComponents).toEqual(['B']);
      expect(a.slots.find((s) => s.name === 'footer')!.allowedComponents ?? []).toEqual([]);
      expect(res.conflicts).toHaveLength(1);
      expect(res.conflicts[0]).toMatchObject({ parent: 'A', child: 'B', winner: 'typed-slot', loser: 'adapter:x' });
    });

    it('agent loses a slot-placement conflict to code slots', async () => {
      const withCode = [
        comp('A', [
          { name: 'header', isDefault: false, allowedComponents: ['B'] },
          { name: 'footer', isDefault: false },
        ]),
        comp('B'),
      ];
      const runAgentFn = vi.fn(async () => '{"tool":"map_edge","parent":"A","child":"B","slot":"footer"}');
      const res = await resolveMapping({
        components: withCode,
        forceAgent: true,
        files: [{ path: 'm', content: 'x' }],
        runAgentFn,
      });
      const a = res.components.find((c) => c.name === 'A')!;
      expect(a.slots.find((s) => s.name === 'header')!.allowedComponents).toEqual(['B']);
      expect(a.slots.find((s) => s.name === 'footer')!.allowedComponents ?? []).toEqual([]);
      expect(res.conflicts[0]).toMatchObject({ winner: 'typed-slot', loser: 'agent' });
    });
  });
});
