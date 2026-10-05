import {
  Node,
  SyntaxKind,
  type SourceFile,
} from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
  ExtractionExclusion,
} from '../../model/component.js';
import { extractTsxComponents, getRenderableExports } from '../support/tsx-shared.js';
import { shouldBeSlot } from '../../evidence/slot-evidence.js';
import {
  extractAllowedComponentsFromTypeText,
  extractAllowedComponentsFromJsdoc,
} from '../../evidence/allowed-components.js';
import {
  collectTypePredicateComponentReferences,
  collectRuntimeTypeCheckComponentReferences,
  collectRenderedComponentReferences,
  collectArrayMapRenderComponentReferences,
} from '../../evidence/structural-slot-evidence.js';
import { collectPropDataflow, getComponentIdentity, type PropForwardingEdge } from './prop-dataflow.js';
import { resolveBestFunctionNode, type FunctionLike } from './function-resolution.js';
import { collectRenderPropSlotNames, extractSlots } from './helpers/extract-react-slots.js';
import { extractPropsFromType } from './helpers/extract-react-props-from-type.js';
import {
  getSyntheticDomAttributeProps,
  hasSyntheticDomChildren,
  containsImportedOmitWrappedCustomProps,
  containsAnyPickType,
} from './helpers/detect-dom-type-patterns.js';
import { resolvePropsType } from './helpers/resolve-react-props-type.js';
import {
  extractDefaultValues,
  filterImplementationOnlyAliasProps,
  extractDestructuredBindingFallbackProps,
} from './helpers/extract-react-binding-defaults.js';
import {
  inferPrimitiveDomPropsFromImplementation,
  hasImplementationChildrenHint,
} from './helpers/collect-react-impl-hints.js';
import { extractPropTypes } from './helpers/extract-react-prop-types.js';

const REACT_ELEMENT_GENERIC_TEST = /(?:React\.)?ReactElement\s*<\s*[A-Za-z_$][\w$.]*/;

function isReactElementGenericSlotType(typeText: string): boolean {
  return REACT_ELEMENT_GENERIC_TEST.test(typeText);
}

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
  _rawJsdoc?: string;
};

type RawComponentDefinitionInternal = RawComponentDefinition & {
  _componentIdentity?: string;
  _propsTypeName?: string;
  _propForwardingEdges?: PropForwardingEdge[];
  _funcNode?: FunctionLike;
};

function isStencilFile(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === '@stencil/core');
}

function sourceFileUsesCreateContext(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const expr = call.getExpression();
    const text = expr.getText();
    return text === 'createContext' || text === 'React.createContext';
  });
}

function isNextJsComponent(filePath: string, exportedNames: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const isAppRouterFile = /\/app\/.*\/(page|layout)\.[jt]sx?$/.test(normalized);
  const hasNextExports = exportedNames.some((name) => name === 'generateMetadata' || name === 'generateStaticParams');
  return isAppRouterFile || hasNextExports;
}

export async function extractReactComponents(filePaths: string[]): Promise<ComponentExtractionResult> {
  const { components, warnings, exclusions, project } = extractTsxComponents(
    filePaths,
    /\.[jt]sx$/,
    (sourceFile, exclusions) => {
      if (isStencilFile(sourceFile)) return [];
      const fileExports = [...sourceFile.getExportedDeclarations().keys()];
      const isNext = isNextJsComponent(sourceFile.getFilePath(), fileExports);
      return extractFromSourceFile(sourceFile, isNext, exclusions);
    },
  );

  const propsToComponent = new Map<string, string>();
  const componentNames = new Set<string>();
  for (const c of components) {
    componentNames.add(c.name);
    if (c._propsTypeName) propsToComponent.set(c._propsTypeName, c.name);
  }

  for (const c of components) {
    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      const found = new Set<string>();
      if (slot._rawTypeText) {
        for (const n of extractAllowedComponentsFromTypeText(slot._rawTypeText, { propsToComponent, componentNames })) {
          found.add(n);
        }
      }
      if (slot._rawJsdoc) {
        for (const n of extractAllowedComponentsFromJsdoc(slot._rawJsdoc, componentNames)) {
          found.add(n);
        }
      }
      delete slot._rawTypeText;
      delete slot._rawJsdoc;
      if (found.size > 0) slot.allowedComponents = [...found].sort();
    }
  }

  const structuralByFile = new Map<string, string[]>();
  const structuralNamesForFile = (filePath: string): string[] => {
    const cached = structuralByFile.get(filePath);
    if (cached) return cached;
    const sourceFile = project?.getSourceFile(filePath);
    if (!sourceFile) return [];
    const ctx = { propsToComponent, componentNames };
    const found = new Set<string>([
      ...collectTypePredicateComponentReferences(sourceFile, ctx),
      ...collectRuntimeTypeCheckComponentReferences(sourceFile, componentNames),
    ]);
    const names = [...found].sort();
    structuralByFile.set(filePath, names);
    return names;
  };

  for (const c of components) {
    const fromFile = structuralNamesForFile(c.source);
    const fromRender = c._funcNode ? collectRenderedComponentReferences(c._funcNode, componentNames, c.name) : [];
    const propTypesByName = new Map(c.props.map((p) => [p.name, p.type]));
    const fromArrayMap = c._funcNode
      ? collectArrayMapRenderComponentReferences(c._funcNode, componentNames, c.name, propTypesByName)
      : [];
    const structural = new Set([...fromFile, ...fromRender, ...fromArrayMap]);
    if (structural.size === 0) continue;

    const synthesisedSlot: RawSlotDefinitionInternal | undefined =
      fromArrayMap.length > 0 && c.slots.length === 0 ? { name: 'children', isDefault: true } : undefined;
    if (synthesisedSlot) (c.slots as RawSlotDefinitionInternal[]).push(synthesisedSlot);

    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      if (slot.allowedComponents && slot.allowedComponents.length > 0) continue;
      slot.structuralAllowedComponents =
        slot === synthesisedSlot ? [...fromArrayMap].sort() : [...structural].sort();
    }
  }

  for (const c of components) {
    delete c._funcNode;
  }

  const componentsByIdentity = new Map(
    components
      .filter((component) => component._componentIdentity)
      .map((component) => [component._componentIdentity!, component]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of components) {
      for (const edge of component._propForwardingEdges ?? []) {
        const target = componentsByIdentity.get(edge.targetComponentIdentity);
        const targetProp = target?.props.find((prop) => prop.name === edge.targetProp);
        const sourceProp = component.props.find((prop) => prop.name === edge.sourceProp);
        if (targetProp?.domAttribute && sourceProp && !sourceProp.domAttribute) {
          sourceProp.domAttribute = true;
          changed = true;
        }
      }
    }
  }
  for (const component of components) {
    delete component._componentIdentity;
    delete component._propsTypeName;
    delete component._propForwardingEdges;
  }

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    exclusions,
  };
}

function extractFromSourceFile(
  sourceFile: SourceFile,
  isNext: boolean,
  exclusions: ExtractionExclusion[],
): RawComponentDefinitionInternal[] {
  const components: RawComponentDefinitionInternal[] = [];
  const usesCreateContext = sourceFileUsesCreateContext(sourceFile);

  for (const { name, declarations } of getRenderableExports(sourceFile, exclusions, {
    allowVariableDeclaration: true,
    hookReason: 'React hook names are not renderable components',
  })) {
    const funcNode = resolveBestFunctionNode(declarations);
    if (!funcNode) continue;
    if (funcNode.getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue;

    const params = funcNode.getParameters();
    if (params.length === 0) {
      components.push({
        name,
        source: sourceFile.getFilePath(),
        sourcePath: sourceFile.getFilePath(),
        framework: isNext ? 'next' : 'react',
        props: [],
        slots: [],
        ...(usesCreateContext && { usesCreateContext: true }),
      });
      continue;
    }

    const resolvedPropsType = resolvePropsType(params[0]);
    const firstParamType = resolvedPropsType.type;
    const firstParamTypeNode = resolvedPropsType.typeNode;
    const renderPropSlotNames = resolvedPropsType.suppressProps
      ? new Set<string>()
      : collectRenderPropSlotNames(firstParamType);
    const { props, hasChildren } = resolvedPropsType.suppressProps
      ? { props: [], hasChildren: false }
      : extractPropsFromType(firstParamType, renderPropSlotNames, firstParamTypeNode);
    const hasMeaningfulExtractedProps = props.some((prop) => !prop.name.startsWith('__scope'));
    const defaults = extractDefaultValues(funcNode);
    const hasImplementationChildren = hasImplementationChildrenHint(funcNode, params[0]);
    const slots = extractSlots(
      firstParamType,
      hasChildren ||
        resolvedPropsType.hasWrappedChildren ||
        hasSyntheticDomChildren(resolvedPropsType.typeNode) ||
        hasImplementationChildren,
    );
    const syntheticDomProps = resolvedPropsType.suppressProps
      ? []
      : getSyntheticDomAttributeProps(resolvedPropsType.typeNode);
    const implementationPrimitiveDomProps =
      !resolvedPropsType.suppressProps && !hasMeaningfulExtractedProps && syntheticDomProps.length === 0
        ? inferPrimitiveDomPropsFromImplementation(funcNode, params[0])
        : [];
    const shouldTryBindingFallback =
      !resolvedPropsType.suppressProps &&
      (containsImportedOmitWrappedCustomProps(firstParamTypeNode) ||
        containsAnyPickType(firstParamTypeNode) ||
        (!hasMeaningfulExtractedProps && Node.isObjectBindingPattern(params[0].getNameNode())));
    const bindingFallbackProps = shouldTryBindingFallback
      ? extractDestructuredBindingFallbackProps(
          funcNode,
          params[0],
          new Set(props.map((prop) => prop.name)),
          renderPropSlotNames,
        )
      : [];

    const mergedPropsByName = new Map<string, RawPropDefinition>();
    for (const prop of props) mergedPropsByName.set(prop.name, prop);
    for (const prop of syntheticDomProps) {
      if (!mergedPropsByName.has(prop.name)) mergedPropsByName.set(prop.name, prop);
    }
    for (const prop of implementationPrimitiveDomProps) {
      if (!mergedPropsByName.has(prop.name)) mergedPropsByName.set(prop.name, prop);
    }
    for (const prop of bindingFallbackProps) {
      if (!mergedPropsByName.has(prop.name)) mergedPropsByName.set(prop.name, prop);
    }
    const resolvedProps = [...mergedPropsByName.values()];

    const noUsefulTypes = resolvedProps.length === 0 || resolvedProps.every((p) => p.type === 'any');
    const finalProps = noUsefulTypes ? (extractPropTypes(sourceFile, name) ?? resolvedProps) : resolvedProps;

    const propsWithDefaults = finalProps.map((p) => {
      if (!defaults.has(p.name)) return p;
      return { ...p, required: false, defaultValue: defaults.get(p.name)! };
    });

    const propDataflow = collectPropDataflow(funcNode, params[0], new Set(propsWithDefaults.map((prop) => prop.name)));
    const filteredProps = filterImplementationOnlyAliasProps(propsWithDefaults, funcNode).map((prop) =>
      propDataflow.intrinsicDomProps.has(prop.name) ? { ...prop, domAttribute: true } : prop,
    );

    const existingSlotNames = new Set(slots.map((s) => s.name));
    const expandedSlots: RawSlotDefinitionInternal[] = [];
    const propsAfterSlotExpansion = filteredProps.filter((prop) => {
      if (existingSlotNames.has(prop.name)) return true;
      const isElementSlot = isReactElementGenericSlotType(prop.type);
      if (shouldBeSlot(prop.name, prop.type) || isElementSlot) {
        expandedSlots.push({
          name: prop.name,
          isDefault: false,
          ...(isElementSlot ? { _rawTypeText: prop.type } : {}),
        });
        return false;
      }
      return true;
    });
    const finalSlots = [...slots, ...expandedSlots];

    const propsTypeName = firstParamTypeNode?.getText?.().trim();
    const propsTypeNameCapture = propsTypeName && /^[A-Za-z_$][\w$]*$/.test(propsTypeName) ? propsTypeName : undefined;

    components.push({
      name,
      source: sourceFile.getFilePath(),
      sourcePath: sourceFile.getFilePath(),
      framework: isNext ? 'next' : 'react',
      props: propsAfterSlotExpansion,
      slots: finalSlots,
      ...(usesCreateContext && { usesCreateContext: true }),
      _componentIdentity: getComponentIdentity(funcNode),
      _funcNode: funcNode,
      ...(propsTypeNameCapture ? { _propsTypeName: propsTypeNameCapture } : {}),
      ...(propDataflow.componentEdges.length > 0 ? { _propForwardingEdges: propDataflow.componentEdges } : {}),
    });
  }

  return components;
}
