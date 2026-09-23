import { describe, it, expect } from 'vitest';
import { validateManifestSlotReferences } from '../src/sources-api/manifest/utils.js';
import type { CDFComponentEntry } from '../src/cdf/index.js';

function component(key: string, entry: Partial<CDFComponentEntry> = {}): { key: string; entry: CDFComponentEntry } {
  return { key, entry: { $type: 'component', $properties: {}, ...entry } };
}

describe('validateManifestSlotReferences', () => {
  it('returns no errors when every $allowedComponents entry resolves within the manifest', () => {
    const icon = component('Icon');
    const iconButton = component('IconButton', {
      $slots: { children: { $allowedComponents: ['Icon'] } },
    });
    expect(validateManifestSlotReferences([icon, iconButton])).toEqual([]);
  });

  it('returns no errors when a component has no slots', () => {
    expect(validateManifestSlotReferences([component('Card')])).toEqual([]);
  });

  it('flags an $allowedComponents entry absent from the manifest', () => {
    const iconButton = component('IconButton', {
      $slots: { children: { $allowedComponents: ['Icon'] } },
    });
    const errors = validateManifestSlotReferences([iconButton]);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('manifest:components/IconButton/$slots/children/$allowedComponents');
    expect(errors[0].message).toContain('Icon');
  });

  it('flags each unresolved name once per slot, and reports multiple unresolved names together', () => {
    const card = component('Card', {
      $slots: { children: { $allowedComponents: ['Icon', 'Missing'] } },
    });
    const errors = validateManifestSlotReferences([card]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Icon');
    expect(errors[0].message).toContain('Missing');
  });

  it('flags unresolved references independently across multiple slots on the same component', () => {
    const card = component('Card', {
      $slots: {
        header: { $allowedComponents: ['MissingHeader'] },
        footer: { $allowedComponents: ['MissingFooter'] },
      },
    });
    const errors = validateManifestSlotReferences([card]);
    expect(errors).toHaveLength(2);
    const paths = errors.map((e) => e.path);
    expect(paths).toContain('manifest:components/Card/$slots/header/$allowedComponents');
    expect(paths).toContain('manifest:components/Card/$slots/footer/$allowedComponents');
  });

  it('does not flag a component referencing itself', () => {
    const recursive = component('TreeNode', {
      $slots: { children: { $allowedComponents: ['TreeNode'] } },
    });
    expect(validateManifestSlotReferences([recursive])).toEqual([]);
  });
});
