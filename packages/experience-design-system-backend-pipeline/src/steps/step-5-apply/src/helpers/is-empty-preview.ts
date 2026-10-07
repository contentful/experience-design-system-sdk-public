import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

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
