import { dirname, resolve } from 'node:path';
import { createObservedCompilerFileSystem, COMPILER_READ_LIMITS } from '../../compiler/observed-file-system.js';
import type { ComponentExtractionResult, RawComponentDefinition } from '../../types/component.js';
import type { CompilerModuleDiagnostic, CompilerReadReceipt, ExtractionDiagnostics } from '../../candidates/types.js';
import type { Project } from 'ts-morph';
import { createSortedExtractionResult } from '../shared/helpers/file-processing/result-normalizer.js';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { resolveVueComponentName } from './helpers/resolve-vue-component-name.js';
import {
  collectVueSourceCandidates,
  forEachVueSfcCompilerContext,
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
  const sourceReader = createObservedCompilerFileSystem(
    resolve(options.projectRoot ?? dirname(vueFiles[0] ?? process.cwd())),
    options.signal,
  );
  const sourceByPath = new Map<string, string>();
  const unreadable: string[] = [];
  const compilerInputs = vueFiles.flatMap((filePath) => {
    try {
      const source = sourceReader.host.readFileSync(filePath);
      sourceByPath.set(resolve(filePath), source);
      return [{ filePath, source, scriptContent: '' }];
    } catch {
      unreadable.push(filePath);
      return [{ filePath, scriptContent: '' }];
    }
  });
  type FileOutcome = {
    item: RawComponentDefinition | null;
    warnings: string[];
    modules: CompilerModuleDiagnostic[];
    reads: CompilerReadReceipt[];
  };
  const outcomes: Array<FileOutcome | undefined> = [];
  const indicesByVirtualPath = new Map<string, number[]>();
  for (let index = 0; index < vueFiles.length; index++) {
    const path = virtualScriptPath(vueFiles[index]!);
    const indices = indicesByVirtualPath.get(path) ?? [];
    indices.push(index);
    indicesByVirtualPath.set(path, indices);
  }
  let filesProcessed = 0;
  let componentsFound = 0;
  const analyseFile = (index: number, project: Project | undefined, diagnostics: ExtractionDiagnostics): void => {
    const filePath = vueFiles[index]!;
    const firstModule = diagnostics.modules.length;
    const firstRead = diagnostics.reads!.length;
    let item: RawComponentDefinition | null = null;
    const warnings: string[] = [];
    try {
      const analysisSource = sourceByPath.get(resolve(filePath));
      if (analysisSource === undefined) throw new Error('Vue source unavailable in bounded snapshot');
      const context: VueReaderContext = { sourcePath: filePath, source: analysisSource, diagnostics, occurrence: 0 };
      if (options.signal?.aborted) vueDiagnostic(context, 'vue-analysis-cancelled');
      else {
        const { errors } = parseSFC(analysisSource);
        const sourceFile = project?.getSourceFile(virtualScriptPath(filePath));
        const syntaxErrors = sourceFile
          ? project!.getProgram().compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode)
          : [];
        if (errors.length || syntaxErrors.length) {
          vueDiagnostic(context, 'vue-sfc-parse-failed');
          warnings.push(
            ...errors.map((error) => `Parse error in ${filePath}: ${String(error)}`),
            ...syntaxErrors.map((error) => `Script parse error in ${filePath}: ${String(error.messageText)}`),
          );
        } else {
          const result = collectVueSourceCandidates(filePath, analysisSource, '', 0, [], [], options, {
            project,
            diagnostics,
          });
          item = {
            name: result.name ?? resolveVueComponentName(filePath),
            source: filePath,
            sourcePath: filePath,
            framework: 'vue',
            props: result.props,
            slots: result.slots,
            sourceCandidates: result.sourceCandidates,
            factSchemaVersion: result.factSchemaVersion,
          };
        }
      }
    } catch (error) {
      warnings.push(`Failed to extract from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    outcomes[index] = {
      item,
      warnings,
      modules: diagnostics.modules.slice(firstModule),
      reads: diagnostics.reads!.slice(firstRead),
    };
    if (item) componentsFound++;
    onProgress?.({ filesProcessed: ++filesProcessed, componentsFound });
  };
  const compiler = forEachVueSfcCompilerContext(compilerInputs, options, (context, diagnostics) => {
    for (const path of context.componentFiles) {
      const index = indicesByVirtualPath.get(path)?.shift();
      if (index !== undefined) analyseFile(index, context.project, diagnostics);
    }
  });
  for (let index = 0; index < vueFiles.length; index++)
    if (!outcomes[index]) analyseFile(index, undefined, compiler.diagnostics);

  const fileReads = outcomes.flatMap((outcome) => outcome?.reads ?? []);
  const fileReadSet = new Set(fileReads);
  const compilerReads = compiler.diagnostics.reads!.filter((read) => !fileReadSet.has(read));
  compiler.diagnostics.reads!.splice(
    0,
    compiler.diagnostics.reads!.length,
    ...compilerReads,
    ...sourceReader.reads.map((read) => ({ ...read, kind: 'framework' as const })),
    ...fileReads,
  );
  Object.assign(compiler.diagnostics.used, {
    frameworkSourceReads: sourceReader.used.compilerReads,
    frameworkSourceBytes: sourceReader.used.compilerBytes,
  });
  Object.assign(compiler.diagnostics.limits, {
    maxFrameworkSourceReads: COMPILER_READ_LIMITS.maxCompilerReads,
    maxFrameworkSourceBytes: COMPILER_READ_LIMITS.maxCompilerBytes,
    maxFrameworkSourceFileBytes: COMPILER_READ_LIMITS.maxCompilerFileBytes,
  });
  const fileModules = new Set(outcomes.flatMap((outcome) => outcome?.modules ?? []));
  compiler.diagnostics.modules = compiler.diagnostics.modules.filter((module) => !fileModules.has(module));
  for (const path of unreadable)
    vueDiagnostic(
      { sourcePath: path, source: '', diagnostics: compiler.diagnostics, occurrence: 0 },
      options.signal?.aborted ? 'vue-analysis-cancelled' : 'vue-sfc-read-failed',
    );
  compiler.diagnostics.modules.push(...outcomes.flatMap((outcome) => outcome?.modules ?? []));
  const components = outcomes.flatMap((outcome) => (outcome?.item ? [outcome.item] : []));
  const warnings = outcomes.flatMap((outcome) => outcome?.warnings ?? []);
  return { ...createSortedExtractionResult(components, warnings), extractionDiagnostics: compiler.diagnostics };
}
