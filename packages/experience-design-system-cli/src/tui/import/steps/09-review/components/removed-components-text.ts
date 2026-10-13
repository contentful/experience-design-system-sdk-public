import type { ComponentTypeSummary } from '@contentful/experience-design-system-types';

/** Header line for the removed-components surfaces (deletion panel + finalize
 *  dialog). Kept in one place so both read identically. `withExpandHint` adds
 *  the panel's "[d] to expand/collapse" affordance, which the dialog omits. */
export function removedComponentsHeader(count: number, withExpandHint: boolean): string {
  const hint = withExpandHint ? '  (press [d] to expand/collapse)' : '';
  return `Removed components (${count}) — will be DELETED from target space${hint}`;
}

/** One bullet line per removed component, matching the deletion panel. */
export function removedComponentLine(rc: ComponentTypeSummary): string {
  return `- ${rc.name}${rc.id ? `  (${rc.id})` : ''}`;
}
