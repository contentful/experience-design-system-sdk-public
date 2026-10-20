import { Node, type SourceFile } from 'ts-morph';
import {
  collectComponentSourceObservations,
  type ComponentSourceObservationOptions,
} from '../../../component-facts/collect-component-source-observations.js';
import { assembleComponentFacts } from '../../../component-facts/assemble-component-facts.js';
import type { ComponentFactCollectors } from '../../../types/component-facts.js';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../types/component.js';
import { shouldBeSlot } from '../../../helpers/evidence/detect-slot-from-prop.js';
import { collectPropDataflow, getComponentIdentity, type PropForwardingEdge } from './collect-prop-dataflow.js';
import { resolveBestFunctionNode, type FunctionLike } from './resolve-component-function.js';
import { collectRenderPropSlotNames, extractSlots } from './extract-react-slots.js';
import { extractPropsFromType } from './extract-react-props-from-type.js';
import {
  getSyntheticDomAttributeProps,
  hasSyntheticDomChildren,
  containsImportedOmitWrappedCustomProps,
  containsAnyPickType,
} from './detect-dom-type-patterns.js';
import { resolvePropsType } from './resolve-react-props-type.js';
import {
  extractDefaultValues,
  extractSourceDefaultExpressions,
  filterImplementationOnlyAliasProps,
  extractDestructuredBindingFallbackProps,
} from './extract-react-binding-defaults.js';
import { inferPrimitiveDomPropsFromImplementation, hasImplementationChildrenHint } from './collect-react-impl-hints.js';
import { extractPropTypes } from './extract-react-prop-types.js';
import { mergeSourceCandidates } from '../../../candidates/source-candidates.js';
import { collectReactSourceObservations } from './collect-react-source-observations.js';
import { recordSourceCandidateDiagnostics } from '../../../compiler/diagnostics.js';
import type { ExtractionDiagnostics } from '../../../candidates/types.js';
import { SOURCE_FACT_SCHEMA_VERSION } from '../../../candidates/types.js';

const REACT_ELEMENT_GENERIC_TEST = /(?:React\.)?ReactElement\s*<\s*[A-Za-z_$][\w$.]*/;

export type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
  _rawJsdoc?: string;
};

export type RawComponentDefinitionInternal = RawComponentDefinition & {
  _componentIdentity?: string;
  _propsTypeName?: string;
  _propForwardingEdges?: PropForwardingEdge[];
  _funcNode?: FunctionLike;
};

export function extractReactComponentFromExport(
  name: string,
  declarations: Node[],
  sourceFile: SourceFile,
  isNext: boolean,
  usesCreateContext: boolean,
  diagnostics?: ExtractionDiagnostics,
  collectors?: ComponentFactCollectors,
  observationOptions?: ComponentSourceObservationOptions,
): RawComponentDefinitionInternal | null {
  const funcNode = resolveBestFunctionNode(declarations);
  if (!funcNode) return null;
  if (funcNode.getSourceFile().getFilePath() !== sourceFile.getFilePath()) return null;

  const framework = isNext ? ('next' as const) : ('react' as const);
  const source = sourceFile.getFilePath();
  const base = {
    name,
    source,
    sourcePath: source,
    framework,
    ...(usesCreateContext && { usesCreateContext: true }),
  };

  const params = funcNode.getParameters();
  const componentFacts = assembleComponentFacts(
    {
      name,
      sourcePath: source,
      framework,
      sourceText: sourceFile.getFullText(),
      sourceRange: {
        startLine: funcNode.getStartLineNumber(),
        endLine: funcNode.getEndLineNumber(),
        startOffset: funcNode.getStart(),
        endOffset: funcNode.getEnd(),
      },
      declaredTypeText: params[0]?.getTypeNode()?.getText() ?? null,
    },
    {
      sourceObservations: () =>
        collectComponentSourceObservations(funcNode, { ...observationOptions, componentBindings: declarations }),
      ...collectors,
    },
    { maxIterations: observationOptions?.closureMaxIterations, signal: observationOptions?.signal },
  );
  const evidence = componentFacts ? { componentFacts } : {};
  if (params.length === 0) {
    return {
      ...base,
      ...evidence,
      props: [],
      slots: [],
      sourceCandidates: [],
      factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    };
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
  const sourceDefaults = extractSourceDefaultExpressions(funcNode);
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
  const allImplementationPrimitiveDomProps = resolvedPropsType.suppressProps
    ? []
    : inferPrimitiveDomPropsFromImplementation(funcNode, params[0]);
  const implementationPrimitiveDomProps =
    !hasMeaningfulExtractedProps && syntheticDomProps.length === 0 ? allImplementationPrimitiveDomProps : [];
  const sourceBindingFallbackProps = resolvedPropsType.suppressProps
    ? []
    : extractDestructuredBindingFallbackProps(funcNode, params[0], renderPropSlotNames);
  const shouldTryBindingFallback =
    !resolvedPropsType.suppressProps &&
    (containsImportedOmitWrappedCustomProps(firstParamTypeNode) ||
      containsAnyPickType(firstParamTypeNode) ||
      (!hasMeaningfulExtractedProps && Node.isObjectBindingPattern(params[0].getNameNode())));
  const bindingFallbackProps = shouldTryBindingFallback ? sourceBindingFallbackProps : [];

  const mergedPropsByName = new Map<string, RawPropDefinition>();
  for (const prop of props) mergedPropsByName.set(prop.name, prop);
  for (const prop of syntheticDomProps) if (!mergedPropsByName.has(prop.name)) mergedPropsByName.set(prop.name, prop);
  for (const prop of implementationPrimitiveDomProps)
    if (!mergedPropsByName.has(prop.name)) mergedPropsByName.set(prop.name, prop);
  for (const prop of bindingFallbackProps)
    if (!mergedPropsByName.has(prop.name)) mergedPropsByName.set(prop.name, prop);
  const resolvedProps = [...mergedPropsByName.values()];

  const noUsefulTypes = resolvedProps.length === 0 || resolvedProps.every((p) => p.type === 'any');
  const finalProps = noUsefulTypes ? (extractPropTypes(sourceFile, name) ?? resolvedProps) : resolvedProps;
  const propsWithDefaults = finalProps.map((p) =>
    defaults.has(p.name) ? { ...p, required: false, defaultValue: defaults.get(p.name)! } : p,
  );

  const propDataflow = collectPropDataflow(funcNode, params[0], new Set(propsWithDefaults.map((p) => p.name)));
  const filteredProps = filterImplementationOnlyAliasProps(propsWithDefaults, funcNode).map((prop) =>
    propDataflow.intrinsicDomProps.has(prop.name) ? { ...prop, domAttribute: true } : prop,
  );

  const existingSlotNames = new Set(slots.map((s) => s.name));
  const expandedSlots: RawSlotDefinitionInternal[] = [];
  const propsAfterSlotExpansion = filteredProps.filter((prop) => {
    if (existingSlotNames.has(prop.name)) return true;
    const isElementSlot = REACT_ELEMENT_GENERIC_TEST.test(prop.type);
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
  const sourceCandidateResult = mergeSourceCandidates(
    collectReactSourceObservations(firstParamType, props, source, funcNode, params[0], {
      suppressProps: resolvedPropsType.suppressProps,
      renderPropSlotNames,
      syntheticDomProps,
      sourceDefaults,
      runtimeProps: finalProps === resolvedProps ? [] : finalProps,
    }),
    propsAfterSlotExpansion,
    [...slots, ...expandedSlots],
  );

  recordSourceCandidateDiagnostics(diagnostics, source, name, sourceCandidateResult);

  const propsTypeName = firstParamTypeNode?.getText?.().trim();
  const propsTypeNameCapture = propsTypeName && /^[A-Za-z_$][\w$]*$/.test(propsTypeName) ? propsTypeName : undefined;

  return {
    ...base,
    ...evidence,
    props: propsAfterSlotExpansion,
    slots: [...slots, ...expandedSlots],
    sourceCandidates: sourceCandidateResult.candidates,
    factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    _componentIdentity: getComponentIdentity(funcNode),
    _funcNode: funcNode,
    ...(propsTypeNameCapture ? { _propsTypeName: propsTypeNameCapture } : {}),
    ...(propDataflow.componentEdges.length > 0 ? { _propForwardingEdges: propDataflow.componentEdges } : {}),
  };
}
