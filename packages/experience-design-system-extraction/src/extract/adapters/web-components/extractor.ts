import { Project, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition, ComponentExtractionResult } from '../../model/component.js';
import { createSortedExtractionResult } from '../support/file-processing/result-normalizer.js';
import { extractProjectSourceFiles } from '../support/file-processing/project-source-files.js';
import {
  extractAccessorProperties,
  extractClassProperties,
  extractJsDocAttributeProps,
  extractObservedAttributes,
  mergePropLists,
  mergeProps,
} from './properties.js';
import { buildTagNameMap, chooseComponentName, resolveWcTagName } from './helpers/resolve-wc-tag-name.js';
import {
  extractSlotsFromTemplate,
  mergeSlotLists,
  extractJsDocSlots,
  extractTemplateContent,
  extractFastTemplateSlots,
} from './helpers/extract-wc-slots.js';
import { extractInheritedClassProperties, extractInheritedSlots } from './helpers/extract-wc-inheritance.js';

function extractFromSourceFile(sourceFile: SourceFile, project: Project): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];
  const tagNameMap = buildTagNameMap(sourceFile);

  for (const classDecl of sourceFile.getClasses()) {
    const className = classDecl.getName();
    if (!className) continue;

    const tagName = resolveWcTagName(classDecl, tagNameMap, project);
    if (!tagName) continue;

    const name = chooseComponentName(classDecl, className, tagName);

    const observedAttrs = extractObservedAttributes(classDecl);
    const inheritedProps = extractInheritedClassProperties(classDecl, project);
    const classProps = mergePropLists(
      extractJsDocAttributeProps(classDecl),
      extractAccessorProperties(classDecl),
      extractClassProperties(classDecl),
    );
    const props = mergeProps(observedAttrs, mergePropLists(inheritedProps, classProps));

    const templateContent = extractTemplateContent(classDecl, project);
    const slots = mergeSlotLists(
      extractInheritedSlots(classDecl, project),
      extractJsDocSlots(classDecl),
      extractSlotsFromTemplate(templateContent),
      extractFastTemplateSlots(classDecl, project),
    );

    components.push({
      name,
      source: sourceFile.getFilePath(),
      sourcePath: sourceFile.getFilePath(),
      framework: 'web-component',
      props,
      slots,
    });
  }

  return components;
}

export async function extractWebComponentDefinitions(filePaths: string[]): Promise<ComponentExtractionResult> {
  const tsFiles = filePaths.filter((f) => /\.[jt]s$/.test(f) && !f.endsWith('.d.ts'));
  if (tsFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const project = new Project({
    compilerOptions: {
      target: 99,
      module: 99,
      moduleResolution: 100,
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of tsFiles) {
    project.addSourceFileAtPath(filePath);
  }

  const { items: components, warnings } = extractProjectSourceFiles(project, (sourceFile) =>
    extractFromSourceFile(sourceFile, project),
  );

  return createSortedExtractionResult(components, warnings);
}
