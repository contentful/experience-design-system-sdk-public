import type { ServerPreviewResponse } from '../../../shared/types/index.js';

export function hasBreakingChangesWithImpact(preview: ServerPreviewResponse): boolean {
  const allChanged = [...preview.components.changed, ...preview.tokens.changed];
  return allChanged.some(
    (c) =>
      c.changeClassification?.classification === 'breaking' &&
      c.impact &&
      (c.impact.affectedFragments > 0 || c.impact.affectedExperiences > 0),
  );
}
