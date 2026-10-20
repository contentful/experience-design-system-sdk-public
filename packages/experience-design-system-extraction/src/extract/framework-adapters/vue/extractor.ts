import os from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentExtractionResult } from '../../types/component.js';
import { runFileExtractionWorkers } from '../shared/helpers/file-processing/file-workers.js';
import { createSortedExtractionResult } from '../shared/helpers/file-processing/result-normalizer.js';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { resolveVueComponentName } from './helpers/resolve-vue-component-name.js';
import {
  collectVueSourceCandidates,
  createVueSfcCompilerContexts,
  virtualScriptPath,
} from './helpers/collect-vue-source-candidates.js';
import { vueDiagnostic, type VueReaderContext } from './helpers/read-vue-runtime.js';
import type { ExtractorOptions } from '../../types/options.js';

export async function extractVueComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const vueFiles = filePaths.filter((path) => path.endsWith('.vue'));
  const sourceByPath = new Map<string, string>();
  const unreadable: string[] = [];
  const compilerInputs = vueFiles.flatMap((filePath) => {
    try {
      const source = readFileSync(filePath, 'utf8');
      sourceByPath.set(resolve(filePath), source);
      return [{ filePath, source, scriptContent: '' }];
    } catch {
      unreadable.push(filePath);
      return [];
    }
  });
  const compilerContexts = createVueSfcCompilerContexts(compilerInputs, options);
  for (const path of unreadable)
    vueDiagnostic(
      { sourcePath: path, source: '', diagnostics: compilerContexts.diagnostics, occurrence: 0 },
      'vue-sfc-read-failed',
    );
  const { items: components, warnings } = await runFileExtractionWorkers(
    vueFiles,
    os.cpus().length,
    async (filePath, source) => {
      const analysisSource = sourceByPath.get(resolve(filePath)) ?? source;
      const context: VueReaderContext = {
        sourcePath: filePath,
        source: analysisSource,
        diagnostics: compilerContexts.diagnostics,
        occurrence: 0,
      };
      if (options.signal?.aborted) {
        vueDiagnostic(context, 'vue-analysis-cancelled');
        return { item: null };
      }
      const { errors } = parseSFC(analysisSource);
      const project = compilerContexts.projectBySfcPath.get(resolve(filePath));
      const sourceFile = project?.getSourceFile(virtualScriptPath(filePath));
      const syntaxErrors = sourceFile
        ? project!.getProgram().compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode)
        : [];
      if (errors.length || syntaxErrors.length) {
        vueDiagnostic(context, 'vue-sfc-parse-failed');
        return {
          item: null,
          warnings: [
            ...errors.map((error) => `Parse error in ${filePath}: ${String(error)}`),
            ...syntaxErrors.map((error) => `Script parse error in ${filePath}: ${String(error.messageText)}`),
          ],
        };
      }
      const result = collectVueSourceCandidates(filePath, analysisSource, '', 0, [], [], options, {
        project,
        diagnostics: compilerContexts.diagnostics,
      });
      return {
        item: {
          name: result.name ?? resolveVueComponentName(filePath),
          source: filePath,
          sourcePath: filePath,
          framework: 'vue' as const,
          props: result.props,
          slots: result.slots,
          sourceCandidates: result.sourceCandidates,
          factSchemaVersion: result.factSchemaVersion,
        },
      };
    },
    (filePath, error) =>
      `Failed to extract from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
  );
  return { ...createSortedExtractionResult(components, warnings), extractionDiagnostics: compilerContexts.diagnostics };
}
