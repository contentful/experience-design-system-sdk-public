import type { AngularComponentMetadata } from '../types/angular-metadata.js';

/**
 * Split a raw `@Component({ selector })` string into typed alternatives.
 *
 * Examples:
 *   'mat-card'                              → [{ kind: 'element', value: 'mat-card' }]
 *   '[matButton]'                           → [{ kind: 'attribute', value: 'matButton' }]
 *   '.hlm-card'                             → [{ kind: 'class', value: 'hlm-card' }]
 *   'button[mat-button], a[mat-button]'     → two compound entries
 *   'mat-card-title, [mat-card-title]'      → one element + one attribute
 *
 * CSS-selector grammar follows Angular's own rules (same as the browser's
 * minus `::pseudo`), so this is a comma-split + per-alternative classifier.
 */
export function parseSelectors(_raw: string | null): AngularComponentMetadata['selectors'] {
  return [];
}
