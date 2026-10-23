import type { SourceFile } from 'ts-morph';
import { canonicalSourceFactPath } from '../../../candidates/bind-source-candidates.js';
import { basename, resolve } from 'node:path';
import type { ExtractionExclusion, ExtractorProgress } from '../../../types/component.js';
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
  onProgress?: (progress: ExtractorProgress) => void,
): {
  components: T[];
  warnings: string[];
  exclusions: ExtractionExclusion[];
  contexts: CompilerContextResult['contexts'];
  extractionDiagnostics: CompilerContextResult['diagnostics'];
  sourceInventory: CompilerContextResult['sourceInventory'];
} {
  onProgress?.({
    filesProcessed: 0,
    componentsFound: 0,
    activity: 'Preparing compiler configuration and dependencies…',
  });
  const extractionContext = getTsxExtractionContext(filePaths, componentFilePattern, options);
  const components: T[] = [];
  const warnings: string[] = [];
  const exclusions: ExtractionExclusion[] = [];
  let filesProcessed = 0;

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
      onProgress?.({
        filesProcessed,
        componentsFound: components.length,
        activity: `Inspecting ${basename(filePath)}…`,
      });
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
        const extracted = extract(sourceFile, exclusions, extractionContext.diagnostics);
        const declaredPath = filePaths.find((path) => canonicalSourceFactPath(path) === sourceFile.getFilePath());
        if (declaredPath)
          for (const component of extracted) {
            if (component && typeof component === 'object') {
              const value = component as Record<string, unknown>;
              for (const field of ['source', 'sourcePath'])
                if (value[field] === sourceFile.getFilePath()) value[field] = resolve(declaredPath);
            }
          }
        components.push(...extracted);
      } catch (e) {
        extractionContext.diagnostics.coverage = 'partial';
        extractionContext.diagnostics.modules.push({
          specifier: 'compiler-analysis',
          fromPath: filePath,
          outcome: 'unavailable',
          reason: 'compiler-source-reader-throw',
        });
        warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        onProgress?.({
          filesProcessed: ++filesProcessed,
          componentsFound: components.length,
          activity: `Inspected ${basename(filePath)}`,
        });
      }
    }
  }

  return {
    components,
    warnings,
    exclusions,
    contexts: extractionContext.contexts,
    extractionDiagnostics: extractionContext.diagnostics,
    sourceInventory: extractionContext.sourceInventory,
  };
}
