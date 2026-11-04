import type { ServerPreviewResponse } from '../../../shared/index.js';

import { sanitizeBreakingChanges } from '@contentful/experience-design-system-types';

export function sanitizePreviewResponse(res: ServerPreviewResponse): ServerPreviewResponse {
  for (const item of res.components?.changed ?? []) {
    const cc = item.changeClassification;
    if (cc && Array.isArray(cc.breakingChanges)) {
      cc.breakingChanges = sanitizeBreakingChanges(cc.breakingChanges);
    }
  }
  return res;
}
