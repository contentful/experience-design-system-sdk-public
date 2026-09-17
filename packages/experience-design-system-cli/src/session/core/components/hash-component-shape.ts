import { createHash } from 'node:crypto';
import type { RawComponentDefinition } from '../../../types.js';

export type RawComponentForHash = RawComponentDefinition & { component_id?: string };

/**
 * Hash the identity-defining shape of a component: framework, name, source
 * path, prop signature (name + type only, no descriptions or defaults), and
 * slot composition (name, isDefault, sorted allowedComponents).
 *
 * Deliberately EXCLUDES fields an LLM may mutate between runs — descriptions,
 * defaults, required flags, allowed values, token references — so cache
 * lookups still hit when only classification data changed.
 *
 * Used as the primary key in the `generation_cache` table.
 */
export function hashComponentShape(component: RawComponentForHash): string {
  const payload = {
    framework: component.framework,
    name: component.name,
    source: component.source,
    props: component.props.map((p) => ({
      name: p.name,
      type: p.type,
    })),
    slots: component.slots.map((s) => ({
      name: s.name,
      isDefault: s.isDefault,
      allowedComponents: [...(s.allowedComponents ?? [])].sort(),
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
