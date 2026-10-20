import { Node, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition, ComponentExtractionResult, ExtractionExclusion } from '../../types/component.js';
import { getTsxExtractionContext, getRenderableExports } from '../shared/helpers/tsx-shared.js';
import { extractVueTsxComponentProps } from './helpers/extract-vue-tsx-props.js';
import { readVueSlots } from '../vue/helpers/read-vue-slots.js';
import { readVueRuntimeProps, vueDiagnostic, type VueReaderContext } from '../vue/helpers/read-vue-runtime.js';
import { mergeSourceCandidates, observeRawProps } from '../../candidates/source-candidates.js';
import { SOURCE_FACT_SCHEMA_VERSION, type ExtractionDiagnostics } from '../../candidates/types.js';
import type { ExtractorOptions } from '../../types/options.js';

export async function extractVueTsxComponents(
  filePaths: string[],
  _onProgress?: (progress: { filesProcessed: number; componentsFound: number }) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const extractionContext = getTsxExtractionContext(filePaths, /\.tsx$/, options);
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

    const resolved = resolveDefineComponentCall(declaration.getInitializer());
    if (!resolved) continue;

    const name = readComponentName(resolved.options) ?? exportName;
    const context: VueReaderContext = {
      sourcePath: sourceFile.getFilePath(),
      source: sourceFile.getFullText(),
      diagnostics,
      occurrence: 0,
    };
    const propsMember = resolved.options.getProperty('props');
    const expression = propsMember && Node.isPropertyAssignment(propsMember) ? propsMember.getInitializer() : undefined;
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

function resolveDefineComponentCall(node: Node | undefined):
  | {
      options: import('ts-morph').ObjectLiteralExpression;
      slotsTypeNode?: Node;
    }
  | undefined {
  if (!node || !Node.isCallExpression(node)) return undefined;

  const directExpressionText = node.getExpression().getText();
  if (/(^|\.)defineComponent$/.test(directExpressionText)) {
    const optionsArg = node.getArguments()[0];
    if (!optionsArg || !Node.isObjectLiteralExpression(optionsArg)) return undefined;
    return { options: optionsArg };
  }

  if (!Node.isCallExpression(node.getExpression())) return undefined;

  const outerArgs = node.getArguments();
  if (outerArgs.length !== 1) return undefined;
  const optionsArg = outerArgs[0];
  if (!Node.isObjectLiteralExpression(optionsArg)) return undefined;

  const innerCall = node.getExpression();
  if (!Node.isCallExpression(innerCall)) return undefined;
  if (!/(^|\.)genericComponent$/.test(innerCall.getExpression().getText())) return undefined;

  return {
    options: optionsArg,
    slotsTypeNode: innerCall.getTypeArguments()[0],
  };
}

function readComponentName(options: import('ts-morph').ObjectLiteralExpression): string | undefined {
  const nameProp = options.getProperty('name');
  if (!nameProp || !Node.isPropertyAssignment(nameProp)) return undefined;
  const initializer = nameProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return undefined;
  return initializer.getLiteralText();
}
