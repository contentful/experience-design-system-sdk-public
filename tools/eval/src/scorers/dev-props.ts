import type { CDFFile, CDFComponentEntry, DevPropLeakageResult } from '../types.js';

/**
 * DOM / a11y / framework pass-through props that should never appear as
 * marketer-configurable properties in a CDF Component Type. Mirrors the
 * exclusion set in packages/experience-design-system-cli/src/analyze/pre-classify.ts.
 *
 * Kept as a local copy in the eval rather than imported because the eval is
 * pinned to a separate workspace package and we want the leakage definition
 * to be stable across branches under test.
 */
const DOM_PASS_THROUGH_PROPS = new Set<string>([
  'className',
  'class',
  'style',
  'styles',
  'id',
  'role',
  'tabIndex',
  'tabindex',
  'name',
  'htmlFor',
  'for',
  'slot',
  'is',
  'lang',
  'dir',
  'hidden',
  'draggable',
  'spellCheck',
  'spellcheck',
  'contentEditable',
  'contenteditable',
  'inputMode',
  'inputmode',
  'autoComplete',
  'autocomplete',
  'autoFocus',
  'autofocus',
  'translate',
  'part',
  'exportparts',
]);

function isDomPassThroughProp(name: string): boolean {
  if (DOM_PASS_THROUGH_PROPS.has(name)) return true;
  if (/^aria[-A-Z]/.test(name)) return true;
  if (name.startsWith('data-')) return true;
  return false;
}

/**
 * Counts DOM / a11y / data-* pass-through props that leaked into the CDF
 * output as marketer-configurable properties. Lower is better; 0 means no
 * developer-facing props were exposed in the editor UI.
 */
export function scoreDevPropLeakage(cdf: CDFFile): DevPropLeakageResult {
  let leaked = 0;
  let totalProps = 0;
  const leakedByComponent: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(cdf)) {
    if (key === '$schema' || typeof value !== 'object' || value === null) continue;
    const entry = value as CDFComponentEntry;
    if (entry.$type !== 'component') continue;

    const props = Object.keys(entry.$properties ?? {});
    totalProps += props.length;

    const leakedHere = props.filter(isDomPassThroughProp);
    if (leakedHere.length > 0) {
      leaked += leakedHere.length;
      leakedByComponent[key] = leakedHere.slice(0, 10);
    }
  }

  return { leaked, totalProps, leakedByComponent };
}
