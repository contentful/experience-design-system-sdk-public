const SUFFIXES = ['Component', 'Directive'];

/**
 * Strip trailing `Component` / `Directive` from a class name. Design systems
 * document their APIs under the suffix-free name (`MatCardComponent` →
 * `MatCard`, `HlmCardTitleDirective` → `HlmCardTitle`).
 */
export function normalizeComponentName(className: string): string {
  for (const suffix of SUFFIXES) {
    if (className.endsWith(suffix) && className.length > suffix.length) {
      return className.slice(0, -suffix.length);
    }
  }
  return className;
}
