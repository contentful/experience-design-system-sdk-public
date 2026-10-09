const SUFFIXES = ['Component', 'Directive'];

/**
 * Strip trailing `Component` / `Directive` from a class name. Mirrors how
 * design systems document their APIs (`MatCardComponent` → `MatCard`,
 * `HlmCardTitleDirective` → `HlmCardTitle`). Returns the original name
 * untouched when no suffix matches.
 */
export function normalizeComponentName(className: string): string {
  for (const suffix of SUFFIXES) {
    if (className.endsWith(suffix) && className.length > suffix.length) {
      return className.slice(0, -suffix.length);
    }
  }
  return className;
}
