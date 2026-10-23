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
