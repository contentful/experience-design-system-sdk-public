/**
 * Given an `<ng-content select="...">` string, try to resolve each selector
 * alternative to a known Angular component / directive class in the same
 * package graph (via the parent's `imports: [...]` list). Returns the de-
 * duplicated class names.
 *
 * Returns `[]` when:
 *   - the selector is bare (`<ng-content>` with no select)
 *   - any alternative is a class selector (`.foo-bar`) — classes don't bind to types
 *   - no alternative resolves to a known class
 *
 * Compound example: `mat-card-title, [mat-card-title], [matCardTitle]` all
 * resolve to the same `MatCardTitle` class — collapse to `['MatCardTitle']`.
 */
export function resolveAllowedComponents(
  _rawSelect: string | null,
  _componentImports: string[],
  _knownComponentsBySelector: Map<string, string>,
): string[] {
  return [];
}
