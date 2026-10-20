import { Node, type Project, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition, ComponentExtractionResult, ExtractorProgress } from '../../types/component.js';
import type { ExtractorOptions } from '../../types/options.js';
import { SOURCE_FACT_SCHEMA_VERSION } from '../../candidates/types.js';
import { buildTagNameMap, chooseComponentName, resolveWcTagName } from './helpers/resolve-wc-tag-name.js';
import { extractFastTemplateSlots, mergeSlotLists } from './helpers/extract-wc-slots.js';
import {
  collectWebComponentClasses,
  createWebComponentCompilerContexts,
  readWebComponentSyntax,
} from './helpers/read-wc-syntax.js';

function extractFromSourceFile(sourceFile: SourceFile, project: Project, result: ComponentExtractionResult): void {
  const tagNameMap = buildTagNameMap(sourceFile);
  for (const { declaration, name: className } of collectWebComponentClasses(sourceFile)) {
    const tagName = Node.isClassDeclaration(declaration)
      ? resolveWcTagName(declaration, tagNameMap, project)
      : tagNameMap.get(className);
    if (!tagName) continue;
    const name = Node.isClassDeclaration(declaration)
      ? chooseComponentName(declaration, className, tagName)
      : className;
    const syntax = readWebComponentSyntax(declaration, sourceFile.getFilePath());
    result.extractionDiagnostics!.modules.push(...syntax.diagnostics);
    Object.assign(result.extractionDiagnostics!.limits, syntax.limits);
    result.extractionDiagnostics!.used.wcDeclarations =
      (result.extractionDiagnostics!.used.wcDeclarations ?? 0) + syntax.used.wcDeclarations;
    const component: RawComponentDefinition = {
      name,
      source: sourceFile.getFilePath(),
      sourcePath: sourceFile.getFilePath(),
      framework: 'web-component',
      props: syntax.props,
      slots: Node.isClassDeclaration(declaration)
        ? mergeSlotLists(syntax.slots, extractFastTemplateSlots(declaration, project))
        : syntax.slots,
      sourceCandidates: syntax.sourceCandidates,
      factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    };
    result.components.push(component);
  }
}

export async function extractWebComponentDefinitions(
  filePaths: string[],
  onProgress?: (progress: ExtractorProgress) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const compiler = createWebComponentCompilerContexts(filePaths, options);
  const result: ComponentExtractionResult = {
    components: [],
    warnings: [],
    extractionDiagnostics: compiler.diagnostics,
  };
  let filesProcessed = 0;
  for (const context of compiler.contexts)
    for (const filePath of context.componentFiles) {
      if (options.signal?.aborted) {
        result.warnings.push('Web-component extraction aborted');
        break;
      }
      const sourceFile = context.project.getSourceFile(filePath);
      if (!sourceFile) {
        result.warnings.push(`Source unavailable: ${filePath}`);
        continue;
      }
      try {
        extractFromSourceFile(sourceFile, context.project, result);
      } catch (error) {
        result.warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      filesProcessed += 1;
      onProgress?.({ filesProcessed, componentsFound: result.components.length });
    }
  result.components.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
