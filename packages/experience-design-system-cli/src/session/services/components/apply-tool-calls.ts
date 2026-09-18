import type { DatabaseSync } from 'node:sqlite';
import type { ToolCall } from '@contentful/experience-design-system-generation';
import { withTransaction } from '../../repositories/shared/with-transaction.js';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import {
  createRawPropAllowedValue,
  createRawSlotAllowedComponent,
  deleteRawPropAllowedValuesForProp,
  deleteRawPropTokenPathsForProp,
  deleteRawSlotAllowedComponentsForSlot,
  updateRawComponentAsGenerated,
  updateRawComponentDescription,
  updateRawComponentRationales,
  updateRawPropAsExcluded,
  updateRawPropCdfClassification,
  updateRawPropDefaultValue,
  updateRawSlotClassification,
  updateRawSlotRationale,
} from '../../repositories/components/raw/write.js';

export interface ApplyToolCallsResult {
  classified: number;
  excluded: number;
  slots: number;
  warnings: string[];
}

export function applyToolCalls(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  componentName: string,
  calls: ToolCall[],
  incomingWarnings: string[],
): ApplyToolCallsResult {
  const now = new Date().toISOString();
  const warnings = [...incomingWarnings];
  let classified = 0;
  let excluded = 0;
  let slots = 0;

  withTransaction(db, () => {
    for (const call of calls) {
      if (call.tool === 'classify_component') {
        if (call.description !== undefined) {
          updateRawComponentDescription(db, sessionId, componentId, call.description);
        }
        if (call.rationale) {
          updateRawComponentRationales(db, sessionId, componentId, {
            description: call.rationale.description,
            props: call.rationale.props,
            slots: call.rationale.slots,
          });
        }
      } else if (call.tool === 'classify_prop') {
        const changes = updateRawPropCdfClassification(
          db,
          sessionId,
          componentId,
          call.prop,
          call.cdf_type,
          call.cdf_category,
          call.token_kind ?? null,
          call.required ?? false,
          call.description ?? null,
          call.reason ?? null,
        );
        if (changes === 0) {
          warnings.push(`${componentName}: classify_prop '${call.prop}' — prop not found, skipped`);
          continue;
        }
        if (call.cdf_type === 'token') {
          // A token property's options list is design token paths, written by
          // map tokens. An enum vocabulary is not part of that definition,
          // whether it is left over from a prior classification or supplied on
          // this very call against the tool contract — so it is dropped either
          // way, and the caller is told when it was asked for explicitly.
          deleteRawPropAllowedValuesForProp(db, sessionId, componentId, call.prop);
          if (call.values && call.values.length > 0) {
            const count = call.values.length;
            warnings.push(
              `${componentName}: classify_prop '${call.prop}' — dropped ${count} value${count === 1 ? '' : 's'} on a token property; its options list is $token.allowed, not $values`,
            );
          }
        } else {
          deleteRawPropTokenPathsForProp(db, sessionId, componentId, call.prop);
          if (call.values && call.values.length > 0) {
            deleteRawPropAllowedValuesForProp(db, sessionId, componentId, call.prop);
            call.values.forEach((v, i) => createRawPropAllowedValue(db, sessionId, componentId, call.prop, i, v));
          }
        }
        if (call.default !== undefined) {
          const storedDefault = typeof call.default === 'boolean' ? String(call.default) : call.default;
          updateRawPropDefaultValue(db, sessionId, componentId, call.prop, storedDefault);
        }
        classified++;
      } else if (call.tool === 'exclude_prop') {
        updateRawPropAsExcluded(db, sessionId, componentId, call.prop, call.reason || null);
        excluded++;
      } else if (call.tool === 'classify_slot') {
        const slotRequired = call.required ?? true;
        const slotChanges = updateRawSlotClassification(
          db,
          sessionId,
          componentId,
          call.slot,
          slotRequired,
          call.description ?? null,
        );
        if (slotChanges === 0) {
          warnings.push(`${componentName}: classify_slot '${call.slot}' — slot not found, skipped`);
          continue;
        }
        if (call.rationale !== undefined) {
          updateRawSlotRationale(db, sessionId, componentId, call.slot, call.rationale);
        }
        if (call.allowed_components !== undefined) {
          deleteRawSlotAllowedComponentsForSlot(db, sessionId, componentId, call.slot);
          call.allowed_components.forEach((ac, i) =>
            createRawSlotAllowedComponent(db, sessionId, componentId, call.slot, i, ac),
          );
        }
        slots++;
      }
    }

    updateRawComponentAsGenerated(db, sessionId, componentId, now);
    updateSessionTimestamp(db, sessionId, now);
  });

  return { classified, excluded, slots, warnings };
}
