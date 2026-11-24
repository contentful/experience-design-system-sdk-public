import { parse as parseSvelte } from 'svelte/compiler';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../types/component.js';
import type { AstNode } from '../types/svelte-ast-node.js';
import { getSvelteComponentName } from './get-svelte-component-name.js';
import { extractTemplateSlots, mergeSlots } from './extract-svelte-template-slots.js';
import { hasV4ExportLetProps, findPropsCall, collectSnippetImportLocals } from './find-svelte-script-declarations.js';
import { extractPropsFromCall, getPropsTypeName, getRetryAnnotation } from './extract-svelte-props.js';
import type { RetryContext } from './resolve-svelte-unresolved-retry.js';
import type { RawSlotDefinitionInternal } from './resolve-svelte-allowed-components.js';
import { computeExtractionScore, deriveNeedsReview } from '../../../helpers/quality/scoring.js';

export async function extractFromSvelteFile(
  filePath: string,
  source: string,
): Promise<{
  component: RawComponentDefinition | null;
  warnings: string[];
  retryContext?: RetryContext;
}> {
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
      `${name}: Svelte export let props are not extracted; prop extraction uses $props() syntax; this component was skipped (${filePath})`,
    );
    return { component: null, warnings };
  }

  const propsCall = instance ? findPropsCall(instance) : null;
  const snippetLocals = instance ? collectSnippetImportLocals(instance) : new Set<string>();

  let props: RawPropDefinition[] = [];
  let propNamesTreatedAsSnippet = new Set<string>();
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
    warnings.push(...result.warnings);
    if (result.additionalReasons) extractionReasons.push(...result.additionalReasons);
  } else if (!instance) {
    warnings.push(`${name}: no instance script block (${filePath}); no props extracted`);
  }

  const templateSlots = fragment ? extractTemplateSlots(fragment) : [];
  const renderedNames = fragment && propsCall ? collectRenderedInputs(fragment, propsCall) : new Set<string>();
  const snippetSlotsFromProps: RawSlotDefinition[] = props
    .filter((prop) => renderedNames.has(prop.name))
    .map(
      (prop): RawSlotDefinitionInternal => ({
        name: prop.name,
        isDefault: false,
        ...(propNamesTreatedAsSnippet.has(prop.name) ? { _rawTypeText: prop.type } : {}),
      }),
    );
  const slotInputNames = new Set(snippetSlotsFromProps.map((slot) => slot.name));
  props = props.filter((prop) => !slotInputNames.has(prop.name));
  const { slots, mixedWarning } = mergeSlots(templateSlots, snippetSlotsFromProps);
  if (mixedWarning) {
    warnings.push(`${name}: mixed render and <slot> usage detected (${filePath}); preserving <slot> declarations`);
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
        slotInputNames,
      };
    }
  }

  return { component, warnings, ...(retryContext ? { retryContext } : {}) };
}

function collectRenderedInputs(fragment: AstNode, propsCall: AstNode): Set<string> {
  const binding = propsCall['id'] as AstNode;
  const locals = new Map<string, string>();
  if (binding.type === 'ObjectPattern') {
    for (const property of (binding['properties'] as AstNode[] | undefined) ?? []) {
      if (property.type !== 'Property') continue;
      const key = property['key'] as AstNode;
      let value = property['value'] as AstNode;
      if (value.type === 'AssignmentPattern') value = value['left'] as AstNode;
      if (key.type === 'Identifier' && value.type === 'Identifier') {
        locals.set(value['name'] as string, key['name'] as string);
      }
    }
  }
  const names = new Set<string>();
  walk(fragment, new Set());
  return names;

  function walk(node: AstNode, shadowed: Set<string>): void {
    if (node.type === 'SnippetBlock') return;
    const scoped = new Set(shadowed);
    if (node.type === 'Fragment') {
      for (const child of (node['nodes'] as AstNode[] | undefined) ?? []) {
        if (child.type !== 'ConstTag') continue;
        const declaration = child['declaration'] as AstNode;
        for (const variable of (declaration['declarations'] as AstNode[] | undefined) ?? []) {
          collectBindings(variable['id'] as AstNode, scoped);
        }
      }
    }
    for (const field of ['context', 'index', 'value', 'error']) {
      const pattern = node[field];
      if (typeof pattern === 'string') scoped.add(pattern);
      else if (pattern && typeof pattern === 'object') collectBindings(pattern as AstNode, scoped);
    }
    if (node.type === 'RenderTag') {
      let expression = node['expression'] as AstNode;
      if (expression.type === 'ChainExpression') expression = expression['expression'] as AstNode;
      if (expression.type === 'CallExpression') {
        const callee = expression['callee'] as AstNode;
        if (callee.type === 'Identifier' && !scoped.has(callee['name'] as string)) {
          const name = locals.get(callee['name'] as string);
          if (name) names.add(name);
        } else if (callee.type === 'MemberExpression' && binding.type === 'Identifier') {
          const object = callee['object'] as AstNode;
          const property = callee['property'] as AstNode;
          if (
            object.type === 'Identifier' &&
            object['name'] === binding['name'] &&
            !scoped.has(object['name'] as string) &&
            !callee['computed'] &&
            property.type === 'Identifier'
          ) {
            names.add(property['name'] as string);
          }
        }
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        for (const value of child) {
          if (value && typeof value === 'object' && typeof value.type === 'string') walk(value as AstNode, scoped);
        }
      } else if (child && typeof child === 'object' && 'type' in child && typeof child.type === 'string') {
        walk(child as AstNode, scoped);
      }
    }
  }

  function collectBindings(pattern: AstNode, names: Set<string>): void {
    if (pattern.type === 'Identifier') names.add(pattern['name'] as string);
    else if (pattern.type === 'Property') collectBindings(pattern['value'] as AstNode, names);
    else if (pattern.type === 'AssignmentPattern') collectBindings(pattern['left'] as AstNode, names);
    else {
      for (const field of ['elements', 'properties']) {
        for (const child of (pattern[field] as AstNode[] | undefined) ?? []) {
          if (child) collectBindings(child, names);
        }
      }
      if (pattern.type === 'RestElement') collectBindings(pattern['argument'] as AstNode, names);
    }
  }
}
