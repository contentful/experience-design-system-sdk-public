import { stripLibraryPrefix } from '../resolution/strip-library-prefix.js';

/**
 * Turn an `<ng-content select="...">` value into a designer-facing slot name.
 *
 * Rules in precedence order:
 *   1. Bare `<ng-content>` → 'children'
 *   2. `[slot=X]` attribute selector → X (literal match)
 *   3. Element selector matching `<parentPrefix>-<rest>` → camelCase of rest
 *      (inside MatCard, `mat-card-title` → 'title')
 *   4. Element/attribute selector with known library prefix → prefix-stripped
 *   5. Class selector `.foo-bar` → last-segment token
 *   6. Compound selector — pick the first element alternative, apply rule 3/4
 *   7. Fallback — the raw selector with whitespace collapsed
 *
 * `parentNormalizedName` is the parent component's suffix-free name (e.g.
 * `MatCard`), used by rule 3 to recognise sub-component selectors.
 */
export function deriveSlotName(rawSelect: string | null, parentNormalizedName: string): string {
  if (!rawSelect || rawSelect.trim() === '') return 'children';

  // Rule 6: compound → first alternative wins. Each alternative is handled
  // by the same rule set recursively.
  if (rawSelect.includes(',')) {
    const first = rawSelect.split(',')[0]!.trim();
    return deriveSingleSelectorName(first, parentNormalizedName);
  }
  return deriveSingleSelectorName(rawSelect.trim(), parentNormalizedName);
}

function deriveSingleSelectorName(sel: string, parentNormalizedName: string): string {
  // Rule 2: `[slot=X]` or `[slot='X']` → X
  const slotAttrMatch = sel.match(/^\[\s*slot\s*=\s*['"]?([^'"\]]+)['"]?\s*\]$/);
  if (slotAttrMatch) return slotAttrMatch[1]!.trim();

  // Rule 5: `.foo-bar` → last segment
  if (sel.startsWith('.')) {
    const last = sel.slice(1).split('-').pop() ?? sel.slice(1);
    return kebabToCamel(last);
  }

  // Attribute selector: `[matCardTitle]` → `matCardTitle`
  const attrMatch = sel.match(/^\[([^=\]]+)\]$/);
  if (attrMatch) {
    const attr = attrMatch[1]!.trim();
    const stripped = tryStripSubComponentOrLibraryPrefix(attr, parentNormalizedName);
    return stripped || kebabToCamel(attr);
  }

  // Element selector (possibly compound like `button[primary]`) → first ident
  const elMatch = sel.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (elMatch) {
    const tag = elMatch[1]!;
    const stripped = tryStripSubComponentOrLibraryPrefix(tag, parentNormalizedName);
    return stripped || kebabToCamel(tag);
  }

  // Rule 7: fallback
  return sel.replace(/\s+/g, '');
}

/**
 * Rule 3 (sub-component selector): inside a parent named `MatCard`, selector
 * `mat-card-title` becomes `title`. The parent prefix is kebab-cased from its
 * normalized name.
 *
 * Rule 4 (library prefix): otherwise `nz-size` becomes `size`.
 *
 * Returns `null` when no prefix matches, letting the caller fall through.
 */
function tryStripSubComponentOrLibraryPrefix(ident: string, parentNormalizedName: string): string | null {
  const parentKebab = pascalToKebab(parentNormalizedName);
  if (parentKebab && ident.startsWith(`${parentKebab}-`)) {
    return kebabToCamel(ident.slice(parentKebab.length + 1));
  }
  // Library-prefix strip on PascalCase: wrap kebab → Pascal → strip → kebab
  const asPascal = kebabToPascal(ident);
  const stripped = stripLibraryPrefix(asPascal);
  if (stripped !== asPascal) {
    return stripped.charAt(0).toLowerCase() + stripped.slice(1);
  }
  return null;
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function kebabToPascal(s: string): string {
  const camel = kebabToCamel(s);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function pascalToKebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
