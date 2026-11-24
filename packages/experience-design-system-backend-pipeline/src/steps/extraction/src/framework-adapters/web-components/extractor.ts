import { Node, type Project, type SourceFile } from 'ts-morph';
import { resolve } from 'node:path';
import { canonicalSourceFactPath } from '../../candidates/bind-source-candidates.js';
import type { RawComponentDefinition, ComponentExtractionResult, ExtractorProgress } from '../../types/component.js';
import type { ExtractorOptions } from '../../types/options.js';
import { SOURCE_FACT_SCHEMA_VERSION } from '../../candidates/types.js';
import { chooseComponentName, resolveWcTagName } from './helpers/resolve-wc-tag-name.js';
import { readDecoratorDefinitionOptions } from './helpers/resolve-wc-decorator-tag.js';
import { collectWcRegistrations, type WcRegistrations } from './helpers/resolve-wc-registrations.js';
import { kebabToPascal } from '../shared/helpers/tsx-shared.js';
import { extractFastTemplateSlots, mergeSlotLists } from './helpers/extract-wc-slots.js';
import {
  collectWebComponentClasses,
  forEachWebComponentCompilerContext,
  readWebComponentSyntax,
} from './helpers/read-wc-syntax.js';

function collectRegisteredClasses(sourceFile: SourceFile, registrations: WcRegistrations) {
  const classes = collectWebComponentClasses(sourceFile);
  for (const [declaration, registration] of registrations)
    if (
      Node.isClassExpression(declaration) &&
      declaration.getSourceFile() === sourceFile &&
      Node.isCallExpression(declaration.getParent())
    )
      classes.push({ declaration, name: declaration.getName() ?? kebabToPascal(registration.tagName) });
  return classes;
}

function extractFromSourceFile(
  sourceFile: SourceFile,
  project: Project,
  registrations: WcRegistrations,
  result: ComponentExtractionResult,
): void {
  for (const { declaration, name: className } of collectRegisteredClasses(sourceFile, registrations)) {
    const tagName = Node.isClassDeclaration(declaration)
      ? resolveWcTagName(declaration, registrations, project)
      : registrations.get(declaration)?.tagName;
    if (!tagName) continue;
    const name = Node.isClassDeclaration(declaration)
      ? chooseComponentName(declaration, className, tagName)
      : className;
    const definitionTemplates = [
      ...(Node.isClassDeclaration(declaration)
        ? readDecoratorDefinitionOptions(declaration).flatMap((options) => options.templates)
        : []),
      ...(registrations.get(declaration)?.templates ?? []),
    ];
    const syntax = readWebComponentSyntax(declaration, sourceFile.getFilePath(), definitionTemplates);
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
  const result: ComponentExtractionResult = {
    components: [],
    warnings: [],
  };
  let filesProcessed = 0;
  const compiler = forEachWebComponentCompilerContext(filePaths, options, (context, diagnostics) => {
    result.extractionDiagnostics = diagnostics;
    const registrations = collectWcRegistrations(
      context.componentFiles.flatMap((filePath) => context.project.getSourceFile(filePath) ?? []),
    );
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
        const componentStart = result.components.length;
        extractFromSourceFile(sourceFile, context.project, registrations, result);
        const suppliedPath = filePaths.find((path) => canonicalSourceFactPath(path) === filePath);
        if (suppliedPath)
          for (const component of result.components.slice(componentStart)) {
            component.source = resolve(suppliedPath);
            component.sourcePath = resolve(suppliedPath);
          }
      } catch (error) {
        result.warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      filesProcessed += 1;
      onProgress?.({ filesProcessed, componentsFound: result.components.length });
    }
  });
  result.extractionDiagnostics = compiler.diagnostics;
  if (options.signal?.aborted && filesProcessed < filePaths.length)
    result.warnings.push('Web-component extraction aborted');
  result.components.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
