import { parse as parseSvelte } from 'svelte/compiler';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../types/component.js';
import { computeExtractionScore, deriveNeedsReview } from '../../../services/quality/helpers/scoring/compute-extraction-score.js';
import type { AstNode } from '../types/svelte-ast-node.js';
import { getSvelteComponentName } from './get-svelte-component-name.js';
import { extractTemplateSlots, mergeSlots } from './extract-svelte-template-slots.js';
import { hasV4ExportLetProps, findPropsCall, collectSnippetImportLocals } from './find-svelte-script-declarations.js';
import { extractPropsFromCall, getPropsTypeName, getRetryAnnotation } from './extract-svelte-props.js';
import type { RetryContext } from './resolve-svelte-unresolved-retry.js';

export async function extractFromSvelteFile(
  filePath: string,
  source: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[]; retryContext?: RetryContext }> {
  const warnings: string[] = [];
  const name = getSvelteComponentName(filePath);

  let ast: AstNode;
  try {
    ast = parseSvelte(source, { modern: true }) as unknown as AstNode;
  } catch (e) {
    return {
      component: null,
      warnings: [`${name}: parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const instance = ast['instance'] as AstNode | undefined;
  const moduleScript = ast['module'] as AstNode | undefined;
  const fragment = ast['fragment'] as AstNode | undefined;

  if (instance && hasV4ExportLetProps(instance)) {
    warnings.push(
      `${name}: Svelte 4 export let syntax not yet supported (${filePath}); see INTEG-4267 for v5-only scope and follow-up`,
    );
    return { component: null, warnings };
  }

  const propsCall = instance ? findPropsCall(instance) : null;
  const snippetLocals = instance ? collectSnippetImportLocals(instance) : new Set<string>();

  let props: RawPropDefinition[] = [];
  let propNamesTreatedAsSnippet = new Set<string>();
  let snippetSlotsFromProps: RawSlotDefinition[] = [];
  const extractionReasons: string[] = [];

  if (propsCall) {
    const result = await extractPropsFromCall({
      propsCall,
      instance: instance!,
      moduleScript,
      filePath,
      componentName: name,
      source,
      snippetLocals,
    });
    props = result.props;
    propNamesTreatedAsSnippet = result.snippetNames;
    snippetSlotsFromProps = result.snippetSlots;
    warnings.push(...result.warnings);
    if (result.additionalReasons) extractionReasons.push(...result.additionalReasons);
  } else if (!instance) {
    warnings.push(`${name}: no instance script block (${filePath}); no props extracted`);
  }

  const templateSlots = fragment ? extractTemplateSlots(fragment) : [];
  const { slots, mixedWarning } = mergeSlots(snippetSlotsFromProps, templateSlots);
  if (mixedWarning) {
    warnings.push(`${name}: mixed Snippet and <slot> usage detected (${filePath}); preferring Snippet entries`);
  }

  const propsTypeNameCapture = propsCall ? getPropsTypeName(propsCall) : undefined;

  const component: RawComponentDefinition & { _propsTypeName?: string } = {
    name,
    source: filePath,
    framework: 'svelte',
    props,
    slots,
    ...(propsTypeNameCapture ? { _propsTypeName: propsTypeNameCapture } : {}),
  };

  const score = computeExtractionScore(component, {
    additionalIssueCount: extractionReasons.length,
    additionalReasons: extractionReasons,
  });
  component.extractionConfidence = score.confidence;
  component.reviewReasons = score.reasons;
  component.needsReview = deriveNeedsReview(score.confidence) || extractionReasons.includes('props-type-unresolved');

  void propNamesTreatedAsSnippet;

  let retryContext: RetryContext | undefined;
  if (extractionReasons.includes('props-type-unresolved') && propsCall && instance) {
    const annotation = getRetryAnnotation(propsCall);
    if (annotation) {
      retryContext = {
        filePath,
        source,
        instance,
        moduleScript,
        annotation,
        componentName: name,
      };
    }
  }

  return { component, warnings, ...(retryContext ? { retryContext } : {}) };
}
