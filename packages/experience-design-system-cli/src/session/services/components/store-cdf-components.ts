import type { DatabaseSync } from 'node:sqlite';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { withTransaction } from '../../repositories/shared/with-transaction.js';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import { deriveComponentId } from '../../core/components/derive-component-id.js';
import { getComponentIdByName, getSlotDefaultsForComponent } from '../../repositories/components/cdf/read.js';
import {
  createMinimalRawComponent,
  createRawPropAllowedValueOrdered,
  createRawPropTokenPath,
  createRawSlotAllowedComponentOrdered,
  createRawSlotForCdf,
  deleteRawSlotAllowedComponentsForComponent,
  deleteRawSlotsForComponent,
  updateCdfComponentDescription,
  updateCdfPropClassification,
  upsertMinimalRawProp,
  upsertRawSlotForCdf,
} from '../../repositories/components/cdf/write.js';
import {
  deleteRawPropAllowedValuesForProp,
  deleteRawPropTokenPathsForProp,
} from '../../repositories/components/raw/write.js';

// storeCDFComponents is only reached from the review editor. A token-paths list
// written here reflects a person's explicit decision — recorded with source='review'.
function writeReviewTokenPaths(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  paths: string[],
): void {
  deleteRawPropTokenPathsForProp(db, sessionId, componentId, propName);
  paths.forEach((path, position) =>
    createRawPropTokenPath(db, sessionId, componentId, propName, 'review', position, path),
  );
}

export function storeCDFComponents(
  db: DatabaseSync,
  sessionId: string,
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): void {
  const now = new Date().toISOString();

  withTransaction(db, () => {
    for (const { key, entry } of components) {
      const existingComponentId = getComponentIdByName(db, sessionId, key);

      if (existingComponentId !== null) {
        updateCdfComponentDescription(db, sessionId, key, entry.$description ?? null);

        for (const [propName, prop] of Object.entries(entry.$properties)) {
          updateCdfPropClassification(
            db,
            sessionId,
            existingComponentId,
            propName,
            prop.$type,
            prop.$category,
            prop['$token.kind'] ?? null,
            prop.$required ?? false,
          );
          if (prop.$values && prop.$values.length > 0) {
            deleteRawPropAllowedValuesForProp(db, sessionId, existingComponentId, propName);
            prop.$values.forEach((v, i) =>
              createRawPropAllowedValueOrdered(db, sessionId, existingComponentId, propName, v, i),
            );
          }
          if (prop.$type === 'token' && prop.$category === 'design') {
            // Reconcile the persisted mapping even when the property omits
            // the field: omission is the dismiss/unrestricted state.
            writeReviewTokenPaths(db, sessionId, existingComponentId, propName, prop['$token.allowed'] ?? []);
          }
        }

        const existingSlotDefaults = getSlotDefaultsForComponent(db, sessionId, existingComponentId);
        deleteRawSlotAllowedComponentsForComponent(db, sessionId, existingComponentId);
        deleteRawSlotsForComponent(db, sessionId, existingComponentId);

        let slotPos = 0;
        for (const [slotName, slot] of Object.entries(entry.$slots ?? {})) {
          const isDefault = existingSlotDefaults.get(slotName) ?? 0;
          createRawSlotForCdf(
            db,
            sessionId,
            existingComponentId,
            slotName,
            isDefault,
            slot.$required ?? false,
            slot.$description ?? null,
            slotPos++,
          );
          if (slot.$allowedComponents && slot.$allowedComponents.length > 0) {
            slot.$allowedComponents.forEach((ac, i) =>
              createRawSlotAllowedComponentOrdered(db, sessionId, existingComponentId, slotName, ac, i),
            );
          }
        }
      } else {
        const newComponentId = deriveComponentId(key, 'generated');
        createMinimalRawComponent(db, sessionId, newComponentId, key, now, entry.$description ?? null);

        let position = 0;
        for (const [propName, prop] of Object.entries(entry.$properties)) {
          upsertMinimalRawProp(
            db,
            sessionId,
            newComponentId,
            propName,
            prop.$required ?? false,
            position++,
            prop.$type,
            prop.$category,
            prop['$token.kind'] ?? null,
          );
          if (prop.$values && prop.$values.length > 0) {
            prop.$values.forEach((v, i) =>
              createRawPropAllowedValueOrdered(db, sessionId, newComponentId, propName, v, i),
            );
          }
          if (prop.$type === 'token' && prop.$category === 'design') {
            writeReviewTokenPaths(db, sessionId, newComponentId, propName, prop['$token.allowed'] ?? []);
          }
        }

        let slotPos = 0;
        for (const [slotName, slot] of Object.entries(entry.$slots ?? {})) {
          upsertRawSlotForCdf(
            db,
            sessionId,
            newComponentId,
            slotName,
            slot.$required ?? false,
            slot.$description ?? null,
            slotPos++,
          );
          if (slot.$allowedComponents && slot.$allowedComponents.length > 0) {
            slot.$allowedComponents.forEach((ac, i) =>
              createRawSlotAllowedComponentOrdered(db, sessionId, newComponentId, slotName, ac, i),
            );
          }
        }
      }
    }

    updateSessionTimestamp(db, sessionId, now);
  });
}
