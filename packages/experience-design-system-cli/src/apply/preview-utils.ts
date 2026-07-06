import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

/**
 * True when a preview response describes zero server-side changes across
 * every diff bucket (components, tokens, taxonomies). Used by:
 *   - `experiences apply` (CLI): short-circuit the confirm-and-push step.
 *   - `experiences import` wizard: block finalize when the resulting push
 *     would be a pure no-op (INTEG-4411 refined guard).
 *
 * A push that produces ANY entry in ANY bucket — including a rejection that
 * removes a server-side component — is NOT empty.
 */
export function isEmptyPreview(preview: ServerPreviewResponse): boolean {
  const { components, tokens, taxonomies } = preview;
  return (
    components.new.length === 0 &&
    components.changed.length === 0 &&
    components.removed.length === 0 &&
    tokens.new.length === 0 &&
    tokens.changed.length === 0 &&
    tokens.removed.length === 0 &&
    taxonomies.new.length === 0 &&
    taxonomies.changed.length === 0 &&
    taxonomies.removed.length === 0
  );
}
