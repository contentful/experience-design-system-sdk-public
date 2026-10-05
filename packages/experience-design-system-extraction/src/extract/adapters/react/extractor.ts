import { type SourceFile } from 'ts-morph';
import type { ComponentExtractionResult } from '../../model/component.js';
import { extractTsxComponents } from '../support/tsx-shared.js';
import { resolveReactAllowedComponents } from './helpers/extract-react-allowed-components.js';
import { synthesizeReactStructuralSlots } from './helpers/synthesize-react-structural-slots.js';
import { resolveReactPropForwarding } from './helpers/resolve-react-prop-forwarding.js';
import { extractFromReactSourceFile } from './helpers/extract-from-react-source-file.js';

function isStencilFile(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === '@stencil/core');
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
      return extractFromReactSourceFile(sourceFile, isNext, exclusions);
    },
  );

  resolveReactAllowedComponents(components);
  synthesizeReactStructuralSlots(components, project);
  resolveReactPropForwarding(components);

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    exclusions,
  };
}
