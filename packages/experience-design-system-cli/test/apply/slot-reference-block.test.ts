import { describe, it, expect, vi } from 'vitest';
import { assertNoUnresolvedSlotReferences } from '../../src/apply/command.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

describe('assertNoUnresolvedSlotReferences — pre-push local resolution check', () => {
  it('is a no-op when every $allowedComponents entry resolves within the manifest', async () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'IconButton',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { children: { $allowedComponents: ['Icon'] } },
        },
      },
      { key: 'Icon', entry: { $type: 'component', $properties: {} } },
    ];
    await expect(assertNoUnresolvedSlotReferences(components)).resolves.toBeUndefined();
  });

  it('exits with a manifest:components error message when a reference is unresolved', async () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'IconButton',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { children: { $allowedComponents: ['Icon'] } },
        },
      },
    ];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    }) as never);

    await expect(assertNoUnresolvedSlotReferences(components)).rejects.toThrow(/process\.exit called with 1/);
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toMatch(/Unresolved \$allowedComponents reference/);
    expect(written).toMatch(/manifest:components\/IconButton\/\$slots\/children\/\$allowedComponents/);
    expect(exitSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
