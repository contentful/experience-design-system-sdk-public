import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

type ReviewJsonComponent = {
  key: string;
  entry: CDFComponentEntry;
};

const HIDDEN_PROP_CATEGORIES = new Set(['state', 'unattached']);

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
