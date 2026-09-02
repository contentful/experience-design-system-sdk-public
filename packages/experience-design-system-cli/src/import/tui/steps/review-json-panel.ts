import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

type ReviewJsonComponent = {
  key: string;
  entry: CDFComponentEntry;
};

const HIDDEN_PROP_CATEGORIES = new Set(['state', 'unattached']);

/**
 * Builds the exact JSON string rendered by the read-only review panel.
 *
 * The FieldEditor intentionally continues to use the unfiltered component
 * definition so toggling the panel never changes what an operator can save.
 */
export function getReviewJsonPanelValue(selected: ReviewJsonComponent | null, showHiddenProps: boolean): string {
  if (!selected) return '';

  const entry = showHiddenProps
    ? selected.entry
    : {
        ...selected.entry,
        $properties: Object.fromEntries(
          Object.entries(selected.entry.$properties ?? {}).filter(
            ([, definition]) => !HIDDEN_PROP_CATEGORIES.has(definition.$category),
          ),
        ),
      };

  return JSON.stringify({ [selected.key]: entry }, null, 2);
}
