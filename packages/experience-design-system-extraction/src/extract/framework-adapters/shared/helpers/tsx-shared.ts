import type { SourceFile } from 'ts-morph';
import type { ExtractionExclusion } from '../../../types/component.js';
import type { ExtractionDiagnostics } from '../../../candidates/types.js';
import type { ExtractorOptions } from '../../../types/options.js';
import { createCompilerContexts, type CompilerContextResult } from '../../../compiler/context.js';

export {
  kebabToPascal,
  extractAllowedValues,
  isIntrinsicJsxElement,
  getJsxTagNameNode,
  getNodeDefinitions,
  getTypeTargetDeclarations,
  getValueTargetDeclarations,
  getTypeReferenceName,
} from './tsx-node-utils.js';

export { resolveDefaultExportName, getRenderableExports } from './tsx-renderable-exports.js';

export function getTsxExtractionContext(
  filePaths: string[],
  componentFilePattern: RegExp,
  options: ExtractorOptions = {},
): CompilerContextResult {
  return createCompilerContexts(filePaths, componentFilePattern, options);
}

export function extractTsxComponents<T>(
  filePaths: string[],
  componentFilePattern: RegExp,
  extract: (sourceFile: SourceFile, exclusions: ExtractionExclusion[], diagnostics: ExtractionDiagnostics) => T[],
  options: ExtractorOptions = {},
): {
  components: T[];
  warnings: string[];
  exclusions: ExtractionExclusion[];
  contexts: CompilerContextResult['contexts'];
  extractionDiagnostics: CompilerContextResult['diagnostics'];
} {
  const extractionContext = getTsxExtractionContext(filePaths, componentFilePattern, options);
  const components: T[] = [];
  const warnings: string[] = [];
  const exclusions: ExtractionExclusion[] = [];

  for (const context of extractionContext.contexts) {
    for (const filePath of context.componentFiles) {
      if (options.signal?.aborted) {
        extractionContext.diagnostics.coverage = 'partial';
        extractionContext.diagnostics.modules.push({
          specifier: 'compiler-analysis',
          fromPath: filePath,
          outcome: 'unavailable',
          reason: 'compiler-analysis-cancelled',
        });
        continue;
      }
      try {
        const sourceFile = context.project.getSourceFile(filePath);
        if (!sourceFile) continue;
        const parseDiagnostics = (sourceFile.compilerNode as unknown as { parseDiagnostics?: readonly unknown[] })
          .parseDiagnostics;
        if (parseDiagnostics?.length) {
          extractionContext.diagnostics.coverage = 'partial';
          extractionContext.diagnostics.modules.push({
            specifier: 'compiler-analysis',
            fromPath: filePath,
            outcome: 'unavailable',
            reason: 'compiler-source-parse-failed',
          });
          warnings.push(`Failed to parse source ${filePath}`);
          continue;
        }
        components.push(...extract(sourceFile, exclusions, extractionContext.diagnostics));
      } catch (e) {
        extractionContext.diagnostics.coverage = 'partial';
        extractionContext.diagnostics.modules.push({
          specifier: 'compiler-analysis',
          fromPath: filePath,
          outcome: 'unavailable',
          reason: 'compiler-source-reader-throw',
        });
        warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    components,
    warnings,
    exclusions,
    contexts: extractionContext.contexts,
    extractionDiagnostics: extractionContext.diagnostics,
  };
}
