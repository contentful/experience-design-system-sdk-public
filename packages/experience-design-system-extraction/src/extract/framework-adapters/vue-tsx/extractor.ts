import { Node, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition, ComponentExtractionResult, ExtractionExclusion } from '../../types/component.js';
import { extractTsxComponents, getRenderableExports } from '../shared/helpers/tsx-shared.js';
import { extractVueTsxComponentProps } from './helpers/extract-vue-tsx-props.js';
import { extractVueTsxComponentSlots } from './helpers/extract-vue-tsx-slots.js';

export async function extractVueTsxComponents(filePaths: string[]): Promise<ComponentExtractionResult> {
  const { components, warnings, exclusions } = extractTsxComponents(filePaths, /\.tsx$/, extractFromSourceFile);

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    exclusions,
  };
}

function extractFromSourceFile(sourceFile: SourceFile, exclusions: ExtractionExclusion[]): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];

  for (const { name, declarations } of getRenderableExports(sourceFile, exclusions, {
    hookReason: 'Vue composition hook names are not renderable components',
  })) {
    const component = extractVueTsxComponent(declarations, name, sourceFile);
    if (component) components.push(component);
  }

  return components;
}

function extractVueTsxComponent(
  declarations: Node[],
  exportName: string,
  sourceFile: SourceFile,
): RawComponentDefinition | undefined {
  for (const declaration of declarations) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    if (declaration.getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue;

    const resolved = resolveDefineComponentCall(declaration.getInitializer());
    if (!resolved) continue;

    const name = readComponentName(resolved.options) ?? exportName;
    const props = extractVueTsxComponentProps(resolved.options);
    const slots = extractVueTsxComponentSlots(resolved.options, resolved.slotsTypeNode);

    return { name, source: sourceFile.getFilePath(), framework: 'vue', props, slots };
  }

  return undefined;
}

function resolveDefineComponentCall(
  node: Node | undefined,
): { options: import('ts-morph').ObjectLiteralExpression; slotsTypeNode?: Node } | undefined {
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

  return { options: optionsArg, slotsTypeNode: innerCall.getTypeArguments()[0] };
}

function readComponentName(options: import('ts-morph').ObjectLiteralExpression): string | undefined {
  const nameProp = options.getProperty('name');
  if (!nameProp || !Node.isPropertyAssignment(nameProp)) return undefined;
  const initializer = nameProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return undefined;
  return initializer.getLiteralText();
}
