import { Node, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition, ComponentExtractionResult, ExtractionExclusion } from '../../types/component.js';
import { getTsxExtractionContext, getRenderableExports } from '../shared/helpers/tsx-shared.js';
import { extractVueTsxComponentProps } from './helpers/extract-vue-tsx-props.js';
import { readVueSlots } from '../vue/helpers/read-vue-slots.js';
import {
  isVueImport,
  readVueRuntimeProps,
  resolveVueRuntimeValue,
  vueDiagnostic,
  type VueReaderContext,
} from '../vue/helpers/read-vue-runtime.js';
import { mergeSourceCandidates, observeRawProps } from '../../candidates/source-candidates.js';
import { SOURCE_FACT_SCHEMA_VERSION, type ExtractionDiagnostics } from '../../candidates/types.js';
import type { ExtractorOptions } from '../../types/options.js';

export async function extractVueTsxComponents(
  filePaths: string[],
  _onProgress?: (progress: { filesProcessed: number; componentsFound: number }) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const extractionContext = getTsxExtractionContext(filePaths, /\.[jt]sx$/, options);
  const extractionDiagnostics = extractionContext.diagnostics;
  const components: RawComponentDefinition[] = [];
  const warnings: string[] = [];
  const exclusions: ExtractionExclusion[] = [];
  let filesProcessed = 0;
  for (const context of extractionContext.contexts) {
    for (const path of context.componentFiles) {
      const sourceFile = context.project.getSourceFile(path);
      if (!sourceFile) continue;
      const reader: VueReaderContext = {
        sourcePath: path,
        source: sourceFile.getFullText(),
        diagnostics: extractionDiagnostics,
        occurrence: 0,
      };
      if (options.signal?.aborted) {
        vueDiagnostic(reader, 'vue-analysis-cancelled');
        continue;
      }
      try {
        components.push(...extractFromSourceFile(sourceFile, exclusions, extractionDiagnostics));
      } catch (error) {
        vueDiagnostic(reader, 'vue-tsx-reader-throw');
        warnings.push(`Failed to extract from ${path}: ${String(error)}`);
      }
      _onProgress?.({ filesProcessed: ++filesProcessed, componentsFound: components.length });
    }
  }

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    exclusions,
    extractionDiagnostics,
  };
}

function extractFromSourceFile(
  sourceFile: SourceFile,
  exclusions: ExtractionExclusion[],
  diagnostics: ExtractionDiagnostics,
): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];

  for (const { name, declarations } of getRenderableExports(sourceFile, exclusions, {
    hookReason: 'Vue composition hook names are not renderable components',
  })) {
    const component = extractVueTsxComponent(declarations, name, sourceFile, diagnostics);
    if (component) components.push(component);
  }

  return components;
}

function extractVueTsxComponent(
  declarations: Node[],
  exportName: string,
  sourceFile: SourceFile,
  diagnostics: ExtractionDiagnostics,
): RawComponentDefinition | undefined {
  for (const declaration of declarations) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    if (declaration.getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue;

    const context: VueReaderContext = {
      sourcePath: sourceFile.getFilePath(),
      source: sourceFile.getFullText(),
      diagnostics,
      occurrence: 0,
    };
    const resolved = resolveDefineComponentCall(declaration.getInitializer(), context);
    if (!resolved) continue;
    const name = readComponentName(resolved.options) ?? exportName;
    const propsMember = resolved.options.getProperty('props');
    const expression =
      propsMember && Node.isPropertyAssignment(propsMember)
        ? propsMember.getInitializer()
        : propsMember && Node.isShorthandPropertyAssignment(propsMember)
          ? propsMember.getNameNode()
          : undefined;
    const runtime = expression
      ? readVueRuntimeProps(expression, context)
      : { props: [], observations: [], resolution: 'resolved' as const };
    const legacyProps = extractVueTsxComponentProps(resolved.options);
    const props = [...new Map([...legacyProps, ...runtime.props].map((prop) => [prop.name, prop])).values()].sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    const slotResult = readVueSlots(sourceFile, context, undefined, resolved.slotsTypeNode, resolved.options);
    const slots = slotResult.slots;
    const collection = mergeSourceCandidates(
      runtime.observations.concat(observeRawProps(legacyProps, 'runtime-object'), slotResult.observations),
      props,
      slots,
    );
    if (!resolved.bindingResolved) {
      for (const candidate of collection.candidates) {
        if (candidate.facts?.certainty === 'certain')
          candidate.facts = {
            ...candidate.facts,
            certainty: 'unknown',
            ambiguityReason: 'vue-component-binding-unresolved',
          };
        for (const observation of candidate.observations) {
          if (observation.fact?.certainty === 'certain')
            observation.fact = {
              ...observation.fact,
              certainty: 'unknown',
              ambiguityReason: 'vue-component-binding-unresolved',
            };
          if (observation.syntax?.reader === 'vue')
            observation.syntax = {
              ...observation.syntax,
              resolution: 'unresolved',
              resolutionReason: observation.syntax.resolutionReason ?? 'vue-component-binding-unresolved',
            };
        }
      }
    }
    if (collection.omittedCount) vueDiagnostic(context, 'vue-source-candidate-budget-exhausted');
    if (!expression) vueDiagnostic(context, 'vue-props-absent', undefined, true);
    else
      vueDiagnostic(
        context,
        `vue-props-${runtime.resolution === 'resolved' ? (runtime.props.length ? 'resolved' : 'empty') : runtime.resolution}`,
        expression,
        runtime.resolution === 'resolved',
      );

    return {
      name,
      source: sourceFile.getFilePath(),
      framework: 'vue',
      props,
      slots,
      sourceCandidates: collection.candidates,
      factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    };
  }

  return undefined;
}

function resolveDefineComponentCall(
  node: Node | undefined,
  context: VueReaderContext,
):
  | {
      options: import('ts-morph').ObjectLiteralExpression;
      bindingResolved: boolean;
      slotsTypeNode?: Node;
    }
  | undefined {
  if (!node || !Node.isCallExpression(node)) return undefined;

  const directExpressionText = node.getExpression().getText();
  if (isVueImport(node.getExpression(), 'defineComponent') || /(^|\.)defineComponent$/.test(directExpressionText)) {
    const argument = node.getArguments()[0];
    const optionsArg = argument ? resolveVueRuntimeValue(argument) : undefined;
    const bindingResolved = isVueImport(node.getExpression(), 'defineComponent');
    if (!bindingResolved) vueDiagnostic(context, 'vue-component-binding-unresolved', node);
    if (!optionsArg || !Node.isObjectLiteralExpression(optionsArg)) {
      vueDiagnostic(context, 'vue-component-options-unresolved', node);
      return undefined;
    }
    return { options: optionsArg, bindingResolved };
  }

  if (!Node.isCallExpression(node.getExpression())) return undefined;

  const outerArgs = node.getArguments();
  if (outerArgs.length !== 1) return undefined;
  const optionsArg = outerArgs[0] ? resolveVueRuntimeValue(outerArgs[0]) : undefined;
  if (!optionsArg || !Node.isObjectLiteralExpression(optionsArg)) return undefined;

  const innerCall = node.getExpression();
  if (!Node.isCallExpression(innerCall)) return undefined;
  const callable = resolveVueRuntimeValue(innerCall);
  const bindingResolved = Boolean(callable && isVueImport(callable, 'defineComponent'));
  const legacyGeneric = /(^|\.)genericComponent$/.test(innerCall.getExpression().getText());
  if (!bindingResolved && !legacyGeneric) return undefined;

  if (!bindingResolved) vueDiagnostic(context, 'vue-component-binding-unresolved', innerCall);
  return {
    options: optionsArg,
    bindingResolved,
    slotsTypeNode: legacyGeneric ? innerCall.getTypeArguments()[0] : undefined,
  };
}

function readComponentName(options: import('ts-morph').ObjectLiteralExpression): string | undefined {
  const nameProp = options.getProperty('name');
  if (!nameProp || !Node.isPropertyAssignment(nameProp)) return undefined;
  const initializer = nameProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return undefined;
  return initializer.getLiteralText();
}
