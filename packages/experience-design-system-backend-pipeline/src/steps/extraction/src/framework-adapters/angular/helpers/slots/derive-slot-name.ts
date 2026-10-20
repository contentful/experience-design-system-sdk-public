import { stripLibraryPrefix } from '../resolution/strip-library-prefix.js';

export function deriveSlotName(rawSelect: string | null, parentNormalizedName: string): string {
  if (!rawSelect || rawSelect.trim() === '') return 'children';

  if (rawSelect.includes(',')) {
    const first = rawSelect.split(',')[0]!.trim();
    return deriveSingleSelectorName(first, parentNormalizedName);
  }
  return deriveSingleSelectorName(rawSelect.trim(), parentNormalizedName);
}

function deriveSingleSelectorName(sel: string, parentNormalizedName: string): string {
  const slotAttrMatch = sel.match(/^\[\s*slot\s*=\s*['"]?([^'"\]]+)['"]?\s*\]$/);
  if (slotAttrMatch) return slotAttrMatch[1]!.trim();

  if (sel.startsWith('.')) {
    const last = sel.slice(1).split('-').pop() ?? sel.slice(1);
    return kebabToCamel(last);
  }

  const attrMatch = sel.match(/^\[([^=\]]+)\]$/);
  if (attrMatch) {
    const attr = attrMatch[1]!.trim();
    const stripped = tryStripSubComponentOrLibraryPrefix(attr, parentNormalizedName);
    return stripped || kebabToCamel(attr);
  }

  const elMatch = sel.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (elMatch) {
    const tag = elMatch[1]!;
    const stripped = tryStripSubComponentOrLibraryPrefix(tag, parentNormalizedName);
    return stripped || kebabToCamel(tag);
  }

  return sel.replace(/\s+/g, '');
}

function tryStripSubComponentOrLibraryPrefix(ident: string, parentNormalizedName: string): string | null {
  const parentKebab = pascalToKebab(parentNormalizedName);
  if (parentKebab && ident.startsWith(`${parentKebab}-`)) {
    return kebabToCamel(ident.slice(parentKebab.length + 1));
  }

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
