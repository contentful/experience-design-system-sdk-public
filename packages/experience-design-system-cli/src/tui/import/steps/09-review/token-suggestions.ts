import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { TokenPropSuggestion, TokenReviewToken } from './types.js';

// Lifted out of legacy TokenReviewPanel.tsx. The panel's UI (slice B) imports this instead of copying it.
/**
 * Design-token props on `entry` with a declared token kind. `paths` is the
 * full compatible token universe when a token catalog is available; `allowed`
 * remains the current subset.
 */
export function collectTokenSuggestions(
  entry: CDFComponentEntry,
  availableTokens: TokenReviewToken[] = [],
): TokenPropSuggestion[] {
  return Object.entries(entry.$properties)
    .filter(([, def]) => {
      const rawKind = (def as { '$token.kind'?: unknown })['$token.kind'];
      return (
        def.$type === 'token' && def.$category === 'design' && (typeof rawKind === 'string' || Array.isArray(rawKind))
      );
    })
    .map(([propName, def]) => {
      const persistedAllowed = [...(def['$token.allowed'] ?? [])];
      const rawKind = (def as { '$token.kind'?: unknown })['$token.kind'];
      const kinds = Array.isArray(rawKind)
        ? rawKind.filter((kind): kind is string => typeof kind === 'string')
        : typeof rawKind === 'string'
          ? rawKind
              .split(',')
              .map((kind) => kind.trim())
              .filter(Boolean)
          : [];
      const compatible = availableTokens.filter((token) => kinds.includes(token.kind)).map((token) => token.path);
      const compatiblePaths = new Set(compatible);
      const allowed =
        availableTokens.length > 0 ? persistedAllowed.filter((path) => compatiblePaths.has(path)) : persistedAllowed;
      const paths = availableTokens.length > 0 ? compatible : allowed;
      return { propName, kinds, paths, suggested: [...allowed], allowed };
    });
}
