import { Project, Node, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition, ComponentExtractionResult } from '../../model/component.js';
import { kebabToPascal } from '../support/tsx-shared.js';
import { createSortedExtractionResult } from '../support/file-processing/result-normalizer.js';
import { extractProjectSourceFiles } from '../support/file-processing/project-source-files.js';
import { isStencilFile, readComponentTag, hasPropertyDecorator } from './helpers/detect-stencil-class.js';
import { extractStencilProps } from './helpers/extract-stencil-props.js';
import { extractStencilSlots } from './helpers/extract-stencil-slots.js';

function collectEventNames(classDecl: Parameters<typeof extractStencilProps>[0]): string[] {
  const eventNames: string[] = [];
  for (const property of classDecl.getProperties()) {
    if (!hasPropertyDecorator(property, 'Event')) continue;
    eventNames.push(property.getName());
  }
  return eventNames.sort();
}

function detectFunctionalComponents(sourceFile: SourceFile, warnings: string[]): void {
  for (const [exportName, declarations] of sourceFile.getExportedDeclarations()) {
    for (const decl of declarations) {
      if (!Node.isVariableDeclaration(decl)) continue;
      const typeNode = decl.getTypeNode();
      if (!typeNode) continue;
      if (!typeNode.getText().startsWith('FunctionalComponent')) continue;
      warnings.push(
        `Stencil FunctionalComponent detected but not extracted: ${exportName} in ${sourceFile.getFilePath()}`,
      );
    }
  }
}

function extractFromStencilSourceFile(sourceFile: SourceFile, warnings: string[]): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];

  for (const classDecl of sourceFile.getClasses()) {
    const tag = readComponentTag(classDecl);
    if (!tag) continue;

    const name = kebabToPascal(tag);
    const props = extractStencilProps(classDecl);
    const slots = extractStencilSlots(classDecl, warnings, name);

    const eventNames = collectEventNames(classDecl);
    if (eventNames.length > 0) {
      warnings.push(`Component ${name} has ${eventNames.length} events not captured: ${eventNames.join(', ')}`);
    }

    components.push({
      name,
      source: sourceFile.getFilePath(),
      sourcePath: sourceFile.getFilePath(),
      framework: 'stencil',
      props,
      slots,
    });
  }

  return components;
}

export async function extractStencilComponents(filePaths: string[]): Promise<ComponentExtractionResult> {
  const tsxFiles = filePaths.filter((f) => /\.[jt]sx$/.test(f));
  if (tsxFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const project = new Project({
    compilerOptions: {
      jsx: 1, // JsxEmit.Preserve
      target: 99, // ScriptTarget.ESNext
      module: 99, // ModuleKind.ESNext
      moduleResolution: 100, // ModuleResolutionKind.Bundler
      skipLibCheck: true,
      allowJs: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of tsxFiles) {
    project.addSourceFileAtPath(filePath);
  }

  const { items: components, warnings } = extractProjectSourceFiles(project, (sourceFile, sourceWarnings) => {
    if (!isStencilFile(sourceFile)) return [];
    const extracted = extractFromStencilSourceFile(sourceFile, sourceWarnings);
    detectFunctionalComponents(sourceFile, sourceWarnings);
    return extracted;
  });

  return createSortedExtractionResult(components, warnings);
}
