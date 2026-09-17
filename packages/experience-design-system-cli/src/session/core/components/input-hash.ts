import { createHash } from 'node:crypto';
import type { RawComponentDefinition } from '../../../types.js';

export type RawComponentForHash = RawComponentDefinition & { component_id?: string };

export function computeComponentInputHash(component: RawComponentForHash): string {
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
