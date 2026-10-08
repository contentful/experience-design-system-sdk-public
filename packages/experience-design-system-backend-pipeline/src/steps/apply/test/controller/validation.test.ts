import { describe, expect, it } from 'vitest';
import { detectSlotCycles } from '../../src/controller/detect-slot-cycles.js';
import { assertNoSlotCycles } from '../../src/controller/assert-no-slot-cycles.js';
import { assertNoUnresolvedSlotReferences } from '../../src/controller/assert-no-unresolved-slot-references.js';
import { formatSlotCycleReport } from '../../src/controller/format-slot-cycle-report.js';
import { formatUnresolvedSlotReferences } from '../../src/controller/format-unresolved-slot-references.js';

const cycleComponents = [
  {
    key: 'A',
    entry: { $type: 'component' as const, $properties: {}, $slots: { s: { $allowedComponents: ['B'] } } },
  },
  {
    key: 'B',
    entry: { $type: 'component' as const, $properties: {}, $slots: { s: { $allowedComponents: ['A'] } } },
  },
];

describe('detectSlotCycles', () => {
  it('returns [] for a cycle-free document', () => {
    expect(detectSlotCycles({ components: [cycleComponents[0]] })).toEqual([]);
  });
  it('detects a 2-node cycle', () => {
    expect(detectSlotCycles({ components: cycleComponents }).length).toBeGreaterThan(0);
  });
});

describe('assertNoSlotCycles', () => {
  it('does not throw for cycle-free input', () => {
    expect(() => assertNoSlotCycles({ components: [cycleComponents[0]] })).not.toThrow();
  });
  it('throws for cyclic input, with a report in the message', () => {
    expect(() => assertNoSlotCycles({ components: cycleComponents })).toThrow(/slot dependency cycle/);
  });
});

describe('assertNoUnresolvedSlotReferences', () => {
  it('throws when a slot references a missing component', () => {
    expect(() =>
      assertNoUnresolvedSlotReferences({
        components: [
          {
            key: 'A',
            entry: { $type: 'component' as const, $properties: {}, $slots: { s: { $allowedComponents: ['Missing'] } } },
          },
        ],
      }),
    ).toThrow(/\$allowedComponents references failed to resolve/);
  });
  it('does not throw when every reference resolves', () => {
    expect(() => assertNoUnresolvedSlotReferences({ components: cycleComponents })).not.toThrow();
  });
});

describe('format helpers', () => {
  it('formatSlotCycleReport renders header + per-cycle lines', () => {
    const cycles = detectSlotCycles({ components: cycleComponents });
    const lines = formatSlotCycleReport({ cycles });
    expect(lines[0]).toMatch(/slot dependency cycle/);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
  it('formatUnresolvedSlotReferences renders header + per-error lines', () => {
    const lines = formatUnresolvedSlotReferences({
      errors: [{ path: '/components/A/$slots/s/$allowedComponents/0', message: 'Unknown component "Missing"' }],
    });
    expect(lines[0]).toMatch(/references failed to resolve/);
    expect(lines[1]).toContain('Unknown component');
  });
});
