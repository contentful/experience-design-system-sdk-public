import type { RawPropDefinition, RawSlotDefinition } from '../../../model/component.js';
import type { AstNode } from '../ast.js';
import { findLocalTypeDeclaration, declarationHasHeritage } from './traverse-svelte-ast.js';
import { renderLiteral } from './render-svelte-type.js';
import { type ResolvedTypeMember, resolveTypeMembers } from './resolve-svelte-type-members.js';

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
};

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
  props: RawPropDefinition[];
  snippetNames: Set<string>;
  snippetSlots: RawSlotDefinition[];
  warnings: string[];
  additionalReasons?: string[];
}

function describeAnnotationForUser(annotation: AstNode | undefined): string {
  if (!annotation) return '<unknown>';
  if (annotation.type === 'TSTypeReference') {
    const name = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    return name ? `'${name}'` : '<unnamed reference>';
  }
  if (annotation.type === 'TSIntersectionType') return '<intersection>';
  if (annotation.type === 'TSUnionType') return '<union>';
  if (annotation.type === 'TSTypeLiteral') return '<inline literal>';
  return `<${annotation.type}>`;
}

function classifyUnresolved(
  annotation: AstNode | undefined,
  members: ResolvedTypeMember[] | null,
  instance: AstNode,
  moduleScript: AstNode | undefined,
): 'empty' | 'partial-heritage' | null {
  if (!annotation) return null;
  if (annotation.type === 'TSTypeLiteral') {
    const litMembers = (annotation['members'] as AstNode[] | undefined) ?? [];
    if (litMembers.length === 0) return null;
  }
  if (members === null || members.length === 0) return 'empty';

  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const decl = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (decl && declarationHasHeritage(decl) && members.every((m) => m.isSnippet)) {
        return 'partial-heritage';
      }
    }
  }
  return null;
}

function propertyOrder(properties: AstNode[]): Map<string, number> {
  const m = new Map<string, number>();
  let i = 0;
  for (const p of properties) {
    if (p.type !== 'Property') continue;
    const name = ((p['key'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (name) m.set(name, i++);
  }
  return m;
}

function sortStable(a: string, b: string, order: Map<string, number>): number {
  const ai = order.get(a) ?? Infinity;
  const bi = order.get(b) ?? Infinity;
  if (ai !== bi) return ai - bi;
  return a.localeCompare(b);
}

function extractFromDestructure(
  propsCall: AstNode,
  typeMembers: ResolvedTypeMember[] | null,
  warnings: string[],
  additionalReasons?: string[],
): PropsExtractionResult {
  const id = propsCall['id'] as AstNode;
  const properties = (id['properties'] as AstNode[] | undefined) ?? [];

  const typeByName = new Map<string, ResolvedTypeMember>();
  if (typeMembers) for (const m of typeMembers) typeByName.set(m.name, m);

  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();
  const snippetSlots: RawSlotDefinition[] = [];
  const seenInDestructure = new Set<string>();
  let dropsRest = false;

  for (const p of properties) {
    if (p.type === 'RestElement') {
      dropsRest = true;
      continue;
    }
    if (p.type !== 'Property') continue;

    const key = p['key'] as AstNode | undefined;
    const name = (key?.['name'] as string | undefined) ?? null;
    if (!name) continue;
    seenInDestructure.add(name);

    const value = p['value'] as AstNode | undefined;
    const hasDefault = value?.type === 'AssignmentPattern';
    const defaultValueRaw = hasDefault ? renderLiteral((value as AstNode)['right'] as AstNode | undefined) : undefined;

    const typeMember = typeByName.get(name);

    if (typeMember?.isSnippet) {
      snippetNames.add(name);
      const slot: RawSlotDefinitionInternal = {
        name,
        isDefault: name === 'children',
        ...(typeMember.description ? { description: typeMember.description } : {}),
      };
      const authorText = typeMember.declaredTypeText ?? typeMember.typeText;
      if (authorText) slot._rawTypeText = authorText;
      snippetSlots.push(slot);
      continue;
    }

    const required = typeMember ? !typeMember.optional && !hasDefault : !hasDefault;
    const propDef: RawPropDefinition = {
      name,
      type: typeMember?.typeText ?? 'unknown',
      required,
    };
    if (defaultValueRaw !== undefined) propDef.defaultValue = defaultValueRaw;
    if (typeMember?.allowedValues) propDef.allowedValues = typeMember.allowedValues;
    if (typeMember?.description) propDef.description = typeMember.description;
    props.push(propDef);
  }

  void dropsRest;
  void seenInDestructure;

  return {
    props: props.sort((a, b) => sortStable(a.name, b.name, propertyOrder(properties))),
    snippetNames,
    snippetSlots,
    warnings,
    ...(additionalReasons && additionalReasons.length > 0 ? { additionalReasons } : {}),
  };
}

export function extractFromTypeMembersOnly(typeMembers: ResolvedTypeMember[]): PropsExtractionResult {
  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();
  const snippetSlots: RawSlotDefinition[] = [];

  for (const m of typeMembers) {
    if (m.isSnippet) {
      snippetNames.add(m.name);
      const slot: RawSlotDefinitionInternal = {
        name: m.name,
        isDefault: m.name === 'children',
        ...(m.description ? { description: m.description } : {}),
      };
      const authorText = m.declaredTypeText ?? m.typeText;
      if (authorText) slot._rawTypeText = authorText;
      snippetSlots.push(slot);
      continue;
    }
    const propDef: RawPropDefinition = {
      name: m.name,
      type: m.typeText,
      required: !m.optional,
    };
    if (m.allowedValues) propDef.allowedValues = m.allowedValues;
    if (m.description) propDef.description = m.description;
    props.push(propDef);
  }

  return { props, snippetNames, snippetSlots, warnings: [] };
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
    const refLabel = describeAnnotationForUser(annotation);
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

export function capturePropsTypeName(propsCall: AstNode): string | undefined {
  const id = propsCall['id'] as AstNode | undefined;
  const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
  if (annotation?.type === 'TSTypeReference') {
    const tn = (annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
    if (tn && /^[A-Za-z_$][\w$]*$/.test(tn)) return tn;
  }
  return undefined;
}

export function buildRetryAnnotation(
  propsCall: AstNode,
): AstNode | undefined {
  const id = propsCall['id'] as AstNode | undefined;
  return (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
}
