import type { RawSlotDefinition } from '../../../types/component.js';
import type { AstNode } from '../types/svelte-ast-node.js';
import { resolveTypeMembers } from './resolve-svelte-type-members.js';
import { extractFromDestructure } from './extract-svelte-from-destructure.js';
import { extractFromTypeMembersOnly } from './extract-svelte-type-member-props.js';
import {
  formatAnnotation,
  classifyUnresolved,
} from './classify-svelte-props-annotation.js';

export { extractFromTypeMembersOnly };
export { getPropsTypeName, getRetryAnnotation } from './classify-svelte-props-annotation.js';

export interface PropsCallContext {
  propsCall: AstNode;
  instance: AstNode;
  moduleScript?: AstNode;
  filePath: string;
  componentName: string;
  source: string;
  snippetLocals: Set<string>;
}

export interface PropsExtractionResult {
  props: import('../../../types/component.js').RawPropDefinition[];
  snippetNames: Set<string>;
  snippetSlots: RawSlotDefinition[];
  warnings: string[];
  additionalReasons?: string[];
}

export async function extractPropsFromCall(ctx: PropsCallContext): Promise<PropsExtractionResult> {
  const warnings: string[] = [];
  const propsCall = ctx.propsCall;
  const id = propsCall['id'] as AstNode;
  const idType = id?.type;

  const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;

  const typeMembers = annotation
    ? await resolveTypeMembers(annotation, ctx.instance, ctx.moduleScript, ctx.filePath, ctx.source)
    : null;

  const unresolved = classifyUnresolved(annotation, typeMembers, ctx.instance, ctx.moduleScript);
  const additionalReasons: string[] = [];
  if (unresolved) {
    const refLabel = formatAnnotation(annotation);
    const heritageNote = unresolved === 'partial-heritage' ? ' (heritage clauses extending unreachable types)' : '';
    warnings.push(
      `${ctx.componentName}: declared Props type ${refLabel} resolved to ${unresolved === 'empty' ? '0' : 'only Snippet-typed'} properties${heritageNote} (${ctx.filePath}) — possible cross-package extends or unreachable type. ` +
        `See https://github.com/contentful/experience-design-system-sdk-public/pull/44 for context and partner workarounds.`,
    );
    additionalReasons.push('props-type-unresolved');
  }

  if (idType === 'ObjectPattern') {
    return extractFromDestructure(ctx.propsCall, typeMembers, warnings, additionalReasons);
  }

  if (idType === 'Identifier') {
    if (typeMembers && typeMembers.length > 0) {
      return { ...extractFromTypeMembersOnly(typeMembers), warnings, additionalReasons };
    }
    if (!unresolved) {
      warnings.push(
        `${ctx.componentName}: $props() called without destructuring (${ctx.filePath}); cannot extract individual props`,
      );
    }
    return { props: [], snippetNames: new Set(), snippetSlots: [], warnings, additionalReasons };
  }

  warnings.push(`${ctx.componentName}: unrecognized $props() binding pattern '${idType}' (${ctx.filePath})`);
  return { props: [], snippetNames: new Set(), snippetSlots: [], warnings, additionalReasons };
}
