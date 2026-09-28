import { describe, it, expect } from 'vitest';
import { validateSlotReferences } from '../src/cdf/index.js';
import type { CDFComponentEntry } from '../src/cdf/index.js';

function component(key: string, entry: Partial<CDFComponentEntry> = {}): { key: string; entry: CDFComponentEntry } {
  return { key, entry: { $type: 'component', $properties: {}, ...entry } };
}

describe('validateSlotReferences', () => {
  it('returns no errors when every $allowedComponents entry resolves within the document', () => {
    const icon = component('Icon');
    const iconButton = component('IconButton', {
      $slots: { children: { $allowedComponents: ['Icon'] } },
    });
    expect(validateSlotReferences([icon, iconButton])).toEqual([]);
  });

  it('returns no errors when a component has no slots', () => {
    expect(validateSlotReferences([component('Card')])).toEqual([]);
  });

  it('flags an $allowedComponents entry absent from the document', () => {
    const iconButton = component('IconButton', {
      $slots: { children: { $allowedComponents: ['Icon'] } },
    });
    const errors = validateSlotReferences([iconButton]);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('manifest:components/IconButton/$slots/children/$allowedComponents');
    expect(errors[0].message).toContain('Icon');
  });

  it('flags each unresolved name once per slot, and reports multiple unresolved names together', () => {
    const card = component('Card', {
      $slots: { children: { $allowedComponents: ['Icon', 'Missing'] } },
    });
    const errors = validateSlotReferences([card]);
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
    const errors = validateSlotReferences([card]);
    expect(errors).toHaveLength(2);
    const paths = errors.map((e) => e.path);
    expect(paths).toContain('manifest:components/Card/$slots/header/$allowedComponents');
    expect(paths).toContain('manifest:components/Card/$slots/footer/$allowedComponents');
  });

  it('does not flag a component referencing itself', () => {
    const recursive = component('TreeNode', {
      $slots: { children: { $allowedComponents: ['TreeNode'] } },
    });
    expect(validateSlotReferences([recursive])).toEqual([]);
  });
});
