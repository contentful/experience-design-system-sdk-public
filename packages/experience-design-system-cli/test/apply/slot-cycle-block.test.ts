import { describe, it, expect, vi } from 'vitest';
import { assertNoSlotCycles } from '../../src/apply/command.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

describe('assertNoSlotCycles — pre-push hard block (INTEG-4401)', () => {
  it('is a no-op when the graph has no cycles', () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'Card',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { header: { $allowedComponents: ['Heading'] } },
        },
      },
      { key: 'Heading', entry: { $type: 'component', $properties: {} } },
    ];
    expect(() => assertNoSlotCycles(components)).not.toThrow();
  });

  it('exits with a manifest:components error message when cycles are present', () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'CycleA',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { header: { $allowedComponents: ['CycleB'] } },
        },
      },
      {
        key: 'CycleB',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { footer: { $allowedComponents: ['CycleA'] } },
        },
      },
    ];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    }) as never);

    expect(() => assertNoSlotCycles(components)).toThrow(/process\.exit called with 1/);
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toMatch(/slot dependency cycle/);
    expect(written).toMatch(/manifest:components\/slot-cycles/);
    expect(written).toMatch(/Fix: remove/);
    expect(exitSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
