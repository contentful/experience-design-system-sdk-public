import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

/**
 * Atomic-mode normalization (spec T8, option a): keep every slot's structure
 * but drop its `$allowedComponents` composition constraint. Applied over the
 * loaded component array regardless of source (`--session` or `--components`),
 * so the atomic bypass cannot leak a live composition link into the pushed
 * manifest. Starving `$allowedComponents` at this single point also makes
 * slot-cycle detection structurally return zero (see T12).
 *
 * Returns a new array with cloned entries; inputs are not mutated.
 */
export function stripAllowedComponents(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): Array<{ key: string; entry: CDFComponentEntry }> {
  return components.map(({ key, entry }) => {
    if (!entry.$slots) return { key, entry };
    const $slots: NonNullable<CDFComponentEntry['$slots']> = {};
    for (const [slotName, slotDef] of Object.entries(entry.$slots)) {
      const { $allowedComponents: _dropped, ...rest } = slotDef;
      $slots[slotName] = rest;
    }
    return { key, entry: { ...entry, $slots } };
  });
}
