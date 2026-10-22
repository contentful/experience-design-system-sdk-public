import { type SourceFile } from 'ts-morph';
import type { ComponentExtractionResult } from '../../types/component.js';
import { extractTsxComponents } from '../shared/helpers/tsx-shared.js';
import { resolveReactAllowedComponents } from './helpers/extract-react-allowed-components.js';
import { synthesizeReactStructuralSlots } from './helpers/synthesize-react-structural-slots.js';
import { resolveReactPropForwarding } from './helpers/resolve-react-prop-forwarding.js';
import { extractFromReactSourceFile } from './helpers/extract-from-react-source-file.js';
import type { ExtractorOptions } from '../../types/options.js';
import { canonicalSourceFactPath } from '../../candidates/bind-source-candidates.js';
import { compilerSourcesFromContexts } from '../../compiler/context.js';

function isStencilFile(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === '@stencil/core');
}

function isNextJsComponent(filePath: string, exportedNames: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const isAppRouterFile = /\/app\/.*\/(page|layout)\.[jt]sx?$/.test(normalized);
  const hasNextExports = exportedNames.some((name) => name === 'generateMetadata' || name === 'generateStaticParams');
  return isAppRouterFile || hasNextExports;
}

export async function extractReactComponents(
  filePaths: string[],
  _onProgress?: (progress: { filesProcessed: number; componentsFound: number }) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const { components, warnings, exclusions, contexts, extractionDiagnostics, sourceInventory } = extractTsxComponents(
    filePaths,
    /\.[jt]sx$/,
    (sourceFile, exclusions, diagnostics) => {
      if (isStencilFile(sourceFile)) return [];
      const fileExports = [...sourceFile.getExportedDeclarations().keys()];
      const isNext = isNextJsComponent(sourceFile.getFilePath(), fileExports);
      return extractFromReactSourceFile(sourceFile, isNext, exclusions, diagnostics, options.componentFactCollectors, {
        selectedSourcePaths: filePaths,
        repositoryRoot: options.projectRoot,
        limits: options.componentObservationLimits,
        signal: options.signal,
        closureMaxIterations: options.sourceClosureMaxIterations,
      });
    },
    options,
  );

  resolveReactAllowedComponents(components);
  for (const context of contexts) {
    const componentPaths = new Set(context.componentFiles);
    synthesizeReactStructuralSlots(
      components.filter((component) =>
        componentPaths.has(canonicalSourceFactPath(component.sourcePath ?? component.source)),
      ),
      context.project,
    );
  }
  resolveReactPropForwarding(components);

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    exclusions,
    extractionDiagnostics,
    sourceInventory,
    compilerSources: compilerSourcesFromContexts(contexts, sourceInventory),
  };
}
