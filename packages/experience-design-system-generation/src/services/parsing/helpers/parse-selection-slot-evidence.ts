import type { SelectionSlotEvidence, SelectionSlotEvidenceCitation } from '../../../types/tool-calls.js';

export function parseSelectionSlotEvidence(value: unknown, warnings: string[]): SelectionSlotEvidence[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push('slot_evidence must be an array — ignored');
    return undefined;
  }

  const evidence: SelectionSlotEvidence[] = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      warnings.push(`slot_evidence[${index}] must be an object — skipped`);
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const evidenceItems = record.evidence;
    if (
      typeof record.name !== 'string' ||
      typeof record.is_real_slot !== 'boolean' ||
      typeof record.reason !== 'string' ||
      !Array.isArray(evidenceItems)
    ) {
      warnings.push(`slot_evidence[${index}] is missing name, is_real_slot, reason, or evidence — skipped`);
      continue;
    }

    const citations: SelectionSlotEvidenceCitation[] = [];
    for (const [citationIndex, citation] of evidenceItems.entries()) {
      if (typeof citation !== 'object' || citation === null) continue;
      const citationRecord = citation as Record<string, unknown>;
      if (
        typeof citationRecord.source === 'string' &&
        typeof citationRecord.line === 'string' &&
        typeof citationRecord.quote === 'string'
      ) {
        citations.push({
          source: citationRecord.source,
          line: citationRecord.line,
          quote: citationRecord.quote,
        });
      } else {
        warnings.push(`slot_evidence[${index}].evidence[${citationIndex}] is missing source, line, or quote — skipped`);
      }
    }

    if (record.is_real_slot && citations.length === 0) {
      warnings.push(`slot_evidence[${index}] marks a real slot without citation evidence — skipped`);
      continue;
    }

    const allowedComponents = record.allowed_components;
    if (
      allowedComponents !== undefined &&
      (!Array.isArray(allowedComponents) || !allowedComponents.every((component) => typeof component === 'string'))
    ) {
      warnings.push(`slot_evidence[${index}].allowed_components must be an array of names — skipped`);
      continue;
    }
    if (record.is_real_slot && (!Array.isArray(allowedComponents) || allowedComponents.length === 0)) {
      warnings.push(`slot_evidence[${index}] marks a real slot without allowed_components — skipped`);
      continue;
    }

    evidence.push({
      name: record.name,
      is_real_slot: record.is_real_slot,
      ...(allowedComponents ? { allowed_components: allowedComponents } : {}),
      evidence: citations,
      reason: record.reason,
    });
  }

  return evidence;
}
