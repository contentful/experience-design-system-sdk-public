import type { BreakingChange, ComponentTypeSummary } from '@contentful/experience-design-system-types';

const PROPERTY_REASON_COPY: Record<string, string> = {
  removed: 'removed',
  added_required_no_default: 'now required, no default',
  type_changed: 'type changed',
  validation_narrowed: 'allowed values narrowed',
};

const SLOT_REASON_COPY: Record<string, string> = {
  slot_removed: 'slot removed',
  slot_allowed_components_narrowed: 'allowed components narrowed',
};

/**
 * BD3 — render a single breaking change as human-readable copy. Branches by KEY
 * PRESENCE (the discriminated-union discriminant): `slotId` → slot branch,
 * otherwise property branch. Property changes are enriched with the
 * `fullProperties` metadata on `current` (type/category) when reachable, and
 * degrade to just id + reason when it is absent. Pure so the copy is pinned by
 * unit tests independent of the Ink render tree.
 */
export function formatBreakingChange(
  bc: BreakingChange,
  current?: Pick<ComponentTypeSummary, 'fullProperties'>,
): string {
  if ('slotId' in bc) {
    const copy = SLOT_REASON_COPY[bc.reason] ?? bc.reason;
    return `${bc.slotId} — ${copy}`;
  }
  const copy = PROPERTY_REASON_COPY[bc.reason] ?? bc.reason;
  const meta = current?.fullProperties?.[bc.propertyId];
  if (meta) {
    const tags = [meta.category, meta.type].filter((t): t is string => typeof t === 'string' && t.length > 0);
    const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    return `${bc.propertyId}${suffix} — ${copy}`;
  }
  return `${bc.propertyId} — ${copy}`;
}
