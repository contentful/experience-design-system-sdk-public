import type { ServerPreviewResponse } from '../../../shared/index.js';

import { sanitizeBreakingChanges, sanitizeSlotBreakingChanges } from '@contentful/experience-design-system-types';

export function sanitizePreviewResponse(res: ServerPreviewResponse): ServerPreviewResponse {
  for (const item of res.components?.changed ?? []) {
    const cc = item.changeClassification;
    if (cc && Array.isArray(cc.breakingChanges)) {
      cc.breakingChanges = sanitizeBreakingChanges(cc.breakingChanges);
    }
    if (cc && Object.hasOwn(cc, 'slotBreakingChanges')) {
      if (Array.isArray(cc.slotBreakingChanges))
        cc.slotBreakingChanges = sanitizeSlotBreakingChanges(cc.slotBreakingChanges);
      else delete cc.slotBreakingChanges;
    }
  }
  return res;
}
