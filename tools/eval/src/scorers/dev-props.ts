import { preClassifyProp } from '@contentful/experience-design-system-cli/src/analyze/pre-classify.js';
import type { CDFFile, CDFComponentEntry, CorpusEntry, DevPropLeakageResult } from '../types.js';

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
  // Bare HTML / framework styling pass-through
  'className',
  'class',
  'classes',
  'classNames',
  'rootClassName',
  'prefixCls',
  'style',
  'styles',
  // Bare HTML attributes
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
  'aria',
  // Framework theming / pass-through escape hatches — dev-facing
  'dt',
  'pt',
  'ptOptions',
  'unstyled',
]);

function isDomPassThroughProp(name: string): boolean {
  if (DOM_PASS_THROUGH_PROPS.has(name)) return true;
  // aria, aria-label, ariaLabel — bare, kebab, and camel forms
  if (/^aria(-|[A-Z]|$)/.test(name)) return true;
  if (name.startsWith('data-')) return true;
  return false;
}

/**
 * Counts DOM / a11y / data-* pass-through props that leaked into the CDF
 * output as marketer-configurable properties. Lower is better; 0 means no
 * developer-facing props were exposed in the editor UI.
 *
 * Also computes a per-prop confusion matrix on the DOM pass-through axis,
 * using the corpus entry's input `rawComponents` to see every prop the
 * pipeline was asked about (not just the ones that survived to the CDF).
 */
export function scoreDevPropLeakage(cdf: CDFFile, corpus: CorpusEntry): DevPropLeakageResult {
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

  let truePositive = 0;
  let falseNegative = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  const falsePositives: DevPropLeakageResult['falsePositives'] = [];

  for (const inputComponent of corpus.rawComponents) {
    const cdfEntry = cdf[inputComponent.name];
    const isCdfEntry =
      cdfEntry && typeof cdfEntry === 'object' && '$type' in cdfEntry && (cdfEntry as CDFComponentEntry).$type === 'component';
    const outputProps = isCdfEntry ? new Set(Object.keys((cdfEntry as CDFComponentEntry).$properties ?? {})) : new Set<string>();

    for (const inputProp of inputComponent.props) {
      const isPassThrough = isDomPassThroughProp(inputProp.name);
      const wasExcluded = !outputProps.has(inputProp.name);

      if (isPassThrough && wasExcluded) truePositive++;
      else if (isPassThrough && !wasExcluded) falseNegative++;
      else if (!isPassThrough && wasExcluded) {
        falsePositive++;
        // Re-derive the pre-classifier verdict to label whether this exclusion
        // was already requested by the deterministic stage. preClassifyProp is
        // the same function the runner uses; calling it here is a stable read
        // of the static rule set, not a behaviour duplication.
        const pre = preClassifyProp(inputProp);
        falsePositives.push({
          component: inputComponent.name,
          prop: inputProp.name,
          type: inputProp.type,
          preClassifyCategory: pre?.category ?? null,
          preClassifyExcluded: pre?.category === 'exclude',
        });
      } else trueNegative++;
    }
  }

  const denominator = truePositive + falseNegative;
  const recall = denominator === 0 ? 1 : truePositive / denominator;

  return {
    leaked,
    totalProps,
    leakedByComponent,
    confusion: { truePositive, falseNegative, falsePositive, trueNegative, recall },
    falsePositives,
  };
}
