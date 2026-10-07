import type { BreakingChange, ServerPreviewResponse } from '../../../shared/types/index.js';

const PROPERTY_BREAKING_REASONS = new Set([
  'removed',
  'added_required_no_default',
  'type_changed',
  'validation_narrowed',
]);
const SLOT_BREAKING_REASONS = new Set(['slot_removed', 'slot_allowed_components_narrowed']);

function sanitizeBreakingChanges(raw: unknown): BreakingChange[] {
  if (!Array.isArray(raw)) return [];
  const out: BreakingChange[] = [];
  for (const bc of raw) {
    if (typeof bc !== 'object' || bc === null) continue;
    const reason = (bc as { reason?: unknown }).reason;
    if (typeof reason !== 'string') continue;
    if ('propertyId' in bc && typeof (bc as { propertyId?: unknown }).propertyId === 'string') {
      if (PROPERTY_BREAKING_REASONS.has(reason)) out.push(bc as BreakingChange);
      continue;
    }
    if ('slotId' in bc && typeof (bc as { slotId?: unknown }).slotId === 'string') {
      if (SLOT_BREAKING_REASONS.has(reason)) out.push(bc as BreakingChange);
      continue;
    }
  }
  return out;
}

export function sanitizePreviewResponse(res: ServerPreviewResponse): ServerPreviewResponse {
  for (const item of res.components?.changed ?? []) {
    const cc = item.changeClassification;
    if (cc && Array.isArray(cc.breakingChanges)) {
      cc.breakingChanges = sanitizeBreakingChanges(cc.breakingChanges);
    }
  }
  return res;
}
