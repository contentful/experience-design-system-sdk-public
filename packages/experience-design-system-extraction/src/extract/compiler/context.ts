import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Project } from 'ts-morph';
import ts from 'typescript';
import type {
  CompilerModuleDiagnostic,
  CompilerProjectDiagnostic,
  CompilerReferenceDiagnostic,
  ExtractionDiagnostics,
} from '../candidates/types.js';
import type { ExtractorOptions } from '../types/options.js';

const DEFAULT_LIMITS = {
  maxRoots: 256,
  maxConfigReads: 256,
  maxConfigFileBytes: 256 * 1024,
  maxConfigBytes: 1024 * 1024,
  maxDirectoryEntries: 2_000,
  maxReferenceDepth: 8,
  maxReferences: 64,
  maxProjectFiles: 4_096,
};

export interface CompilerProjectContext {
  root: string;
  configPath: string | null;
  project: Project;
  componentFiles: string[];
  assignedFiles: string[];
}

export interface CompilerContextResult {
  contexts: CompilerProjectContext[];
  diagnostics: ExtractionDiagnostics;
}

export interface VirtualCompilerSource {
  path: string;
  content: string;
}

interface ParsedConfig {
  path: string;
  parsed: ts.ParsedCommandLine;
  text: string;
  status: CompilerProjectDiagnostic['status'];
  diagnostics: string[];
}

function isWithin(root: string, filePath: string): boolean {
  const relativePath = relative(root, filePath);
  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

function commonDirectory(filePaths: readonly string[]): string {
  if (filePaths.length === 0) return process.cwd();
  let common = resolve(dirname(filePaths[0]!));
  for (const filePath of filePaths.slice(1)) {
    const candidate = resolve(dirname(filePath));
    while (!isWithin(common, candidate)) {
      const parent = dirname(common);
      if (parent === common) return common;
      common = parent;
    }
    while (!isWithin(candidate, common)) {
      const parent = dirname(common);
      if (parent === common) break;
      common = parent;
    }
  }
  return common;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function toPlainOptions(options: ts.CompilerOptions): Record<string, string | number | boolean | null> {
  const plain: Record<string, string | number | boolean | null> = Object.create(null) as Record<
    string,
    string | number | boolean | null
  >;
  for (const [key, value] of Object.entries(options)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      plain[key] = value as string | number | boolean | null;
    } else if (value !== undefined) {
      plain[key] = JSON.stringify(value);
    }
  }
  return plain;
}

function configNames(directory: string): string[] {
  const tsConfig = resolve(directory, 'tsconfig.json');
  const jsConfig = resolve(directory, 'jsconfig.json');
  const found = [tsConfig, jsConfig].filter((path) => existsSync(path));
  return found;
}

function findNearestConfig(
  filePath: string,
  projectRoot: string,
  maxReads: number,
): { path: string | null; ambiguous: boolean } {
  let current = dirname(resolve(filePath));
  let reads = 0;
  while (isWithin(projectRoot, current) && reads < maxReads) {
    const found = configNames(current);
    if (found.length > 0)
      return { path: found.find((path) => path.endsWith('tsconfig.json')) ?? found[0]!, ambiguous: found.length > 1 };
    const parent = dirname(current);
    if (parent === current || !isWithin(projectRoot, parent)) break;
    current = parent;
    reads += 1;
  }
  return { path: null, ambiguous: false };
}

function referencePath(reference: ts.ProjectReference): string {
  const path = resolve(reference.path);
  return path.endsWith('.json') ? path : resolve(path, 'tsconfig.json');
}

function configReferenceContains(reference: ts.ProjectReference, filePath: string): boolean {
  return isWithin(dirname(referencePath(reference)), resolve(filePath));
}

function makeCompilerHost(projectRoot: string, limits: typeof DEFAULT_LIMITS, explicitRoots: readonly string[]) {
  const reads = new Map<string, string | null>();
  const hashByPath = new Map<string, string>();
  const diagnostics: string[] = [];
  const used = { configReads: 0, configBytes: 0, directoryEntries: 0, references: 0, projectFiles: 0 };

  const readFile = (path: string): string | undefined => {
    const canonicalPath = resolve(path);
    const cached = reads.get(canonicalPath);
    if (cached !== undefined) return cached ?? undefined;
    if (!isWithin(projectRoot, canonicalPath)) {
      diagnostics.push(`config-read-outside-project-root:${relative(projectRoot, canonicalPath)}`);
    }
    if (used.configReads >= limits.maxConfigReads) {
      diagnostics.push('config-read-budget-exhausted');
      reads.set(canonicalPath, null);
      return undefined;
    }
    used.configReads += 1;
    try {
      const stat = statSync(canonicalPath);
      if (!stat.isFile()) {
        reads.set(canonicalPath, null);
        return undefined;
      }
      if (stat.size > limits.maxConfigFileBytes || used.configBytes + stat.size > limits.maxConfigBytes) {
        diagnostics.push(`config-byte-budget-exhausted:${relative(projectRoot, canonicalPath)}`);
        reads.set(canonicalPath, null);
        return undefined;
      }
      const text = readFileSync(canonicalPath, 'utf8');
      const byteLength = Buffer.byteLength(text, 'utf8');
      if (byteLength > limits.maxConfigFileBytes || used.configBytes + byteLength > limits.maxConfigBytes) {
        diagnostics.push(`config-byte-budget-exhausted:${relative(projectRoot, canonicalPath)}`);
        reads.set(canonicalPath, null);
        return undefined;
      }
      used.configBytes += byteLength;
      hashByPath.set(canonicalPath, createHash('sha256').update(text).digest('hex'));
      reads.set(canonicalPath, text);
      return text;
    } catch {
      reads.set(canonicalPath, null);
      return undefined;
    }
  };

  const host: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => projectRoot,
    fileExists: (path) => readFile(path) !== undefined,
    readFile,
    readDirectory: (root, extensions, excludes, includes, depth) => {
      const canonicalRoot = resolve(root);
      if (!isWithin(projectRoot, canonicalRoot)) {
        diagnostics.push(`config-directory-outside-project-root:${relative(projectRoot, canonicalRoot)}`);
      }
      void excludes;
      void includes;
      diagnostics.push('config-file-discovery-limited-to-explicit-input-roots');
      const candidates = explicitRoots.filter((path) => {
        if (!isWithin(canonicalRoot, path)) return false;
        if (depth !== undefined && relative(canonicalRoot, path).split(sep).length > depth) return false;
        return !extensions || extensions.length === 0 || extensions.some((extension) => path.endsWith(extension));
      });
      const remaining = Math.max(0, limits.maxDirectoryEntries - used.directoryEntries);
      used.directoryEntries += Math.min(candidates.length, remaining);
      if (candidates.length > remaining) diagnostics.push('config-directory-entry-budget-exhausted');
      return candidates.slice(0, remaining);
    },
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => diagnostics.push(formatDiagnostic(diagnostic)),
  };

  return { host, readFile, hashByPath, diagnostics, used };
}

function parseConfig(path: string, reader: ReturnType<typeof makeCompilerHost>): ParsedConfig {
  const text = reader.readFile(path);
  if (text === undefined) {
    return {
      path,
      text: '',
      status: 'invalid',
      diagnostics: ['config-unreadable-or-over-budget'],
      parsed: { options: { noEmit: true }, fileNames: [], errors: [], projectReferences: undefined, raw: {} },
    };
  }
  const json = ts.parseConfigFileTextToJson(path, text);
  if (json.error || !json.config || typeof json.config !== 'object') {
    return {
      path,
      text,
      status: 'invalid',
      diagnostics: json.error ? [formatDiagnostic(json.error)] : ['config-not-an-object'],
      parsed: {
        options: { noEmit: true },
        fileNames: [],
        errors: json.error ? [json.error] : [],
        projectReferences: undefined,
        raw: {},
      },
    };
  }
  const parsed = ts.parseJsonConfigFileContent(json.config, reader.host, dirname(path), { noEmit: true }, path);
  const diagnostics = parsed.errors.map(formatDiagnostic);
  return {
    path,
    text,
    status: diagnostics.length > 0 ? 'invalid' : 'configured',
    diagnostics,
    parsed,
  };
}

function selectReferencedConfig(
  config: ParsedConfig,
  filePath: string,
  reader: ReturnType<typeof makeCompilerHost>,
  visited = new Set<string>(),
  depth = 0,
  maxDepth = DEFAULT_LIMITS.maxReferenceDepth,
): { config: ParsedConfig; outcome: CompilerReferenceDiagnostic['outcome']; details: string[] } {
  if (depth >= maxDepth)
    return { config, outcome: 'budget-exhausted', details: ['project-reference-depth-budget-exhausted'] };
  if (visited.has(config.path)) return { config, outcome: 'cycle', details: ['project-reference-cycle'] };
  visited.add(config.path);
  const references = config.parsed.projectReferences ?? [];
  reader.used.references += references.length;
  if (reader.used.references > DEFAULT_LIMITS.maxReferences)
    return { config, outcome: 'budget-exhausted', details: ['project-reference-count-budget-exhausted'] };
  if (references.length === 0) {
    return { config, outcome: config.status === 'configured' ? 'selected' : 'invalid', details: config.diagnostics };
  }
  const matching = references.filter((reference) => configReferenceContains(reference, filePath));
  if (matching.length > 1)
    return { config, outcome: 'ambiguous', details: ['root-matches-overlapping-project-references'] };
  if (matching.length === 0)
    return { config, outcome: 'ambiguous', details: ['root-not-covered-by-project-references', ...config.diagnostics] };
  const selectedPath = referencePath(matching[0]!);
  const referenced = parseConfig(selectedPath, reader);
  if (referenced.status === 'invalid')
    return { config: referenced, outcome: 'invalid', details: referenced.diagnostics };
  return selectReferencedConfig(referenced, filePath, reader, visited, depth + 1, maxDepth);
}

function moduleDiagnostics(context: CompilerProjectContext): CompilerModuleDiagnostic[] {
  const diagnostics: CompilerModuleDiagnostic[] = [];
  for (const sourceFile of context.project.getSourceFiles()) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      let target: import('ts-morph').SourceFile | undefined;
      try {
        target = declaration.getModuleSpecifierSourceFile();
      } catch {
        target = undefined;
      }
      diagnostics.push({
        specifier,
        fromPath: sourceFile.getFilePath(),
        outcome: !target ? 'unresolved' : target.isFromExternalLibrary() ? 'external' : 'resolved',
        reason: target ? null : 'module-not-resolved-in-project-context',
      });
    }
  }
  const unique = new Map(diagnostics.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]));
  return [...unique.values()].sort(
    (left, right) => left.fromPath.localeCompare(right.fromPath) || left.specifier.localeCompare(right.specifier),
  );
}

export function createCompilerContexts(
  filePaths: readonly string[],
  componentFilePattern: RegExp,
  options: ExtractorOptions = {},
  virtualSources: readonly VirtualCompilerSource[] = [],
): CompilerContextResult {
  const projectRoot = resolve(options.projectRoot ?? commonDirectory(filePaths));
  const limits = DEFAULT_LIMITS;
  const eligibleFiles = [...new Set(filePaths.map((path) => resolve(path)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const rootPaths = eligibleFiles.slice(0, limits.maxRoots);
  const reader = makeCompilerHost(projectRoot, limits, rootPaths);
  const virtualSourceByPath = new Map(virtualSources.map((source) => [resolve(source.path), source.content]));
  const groups = new Map<
    string,
    {
      config: ParsedConfig | null;
      status: CompilerProjectDiagnostic['status'];
      roots: string[];
      files: string[];
      diagnostics: string[];
    }
  >();
  const referenceDiagnostics: CompilerReferenceDiagnostic[] = [];
  const projectDiagnostics: CompilerProjectDiagnostic[] = [];

  for (const rootPath of rootPaths) {
    if (options.signal?.aborted) {
      projectDiagnostics.push({
        root: rootPath,
        configPath: null,
        configHash: null,
        status: 'invalid',
        options: {},
        diagnostics: ['compiler-analysis-aborted'],
      });
      referenceDiagnostics.push({ root: rootPath, configPath: null, outcome: 'budget-exhausted' });
      continue;
    }
    const nearest = findNearestConfig(rootPath, projectRoot, limits.maxConfigReads);
    let selectedConfig: ParsedConfig | null = null;
    let status: CompilerProjectDiagnostic['status'] = nearest.ambiguous ? 'ambiguous' : 'fallback';
    let diagnostics: string[] = nearest.ambiguous ? ['multiple-config-files-at-same-root'] : [];
    let referenceOutcome: CompilerReferenceDiagnostic['outcome'] = 'fallback';

    if (nearest.path) {
      const baseConfig = parseConfig(nearest.path, reader);
      const referenceSelection = selectReferencedConfig(baseConfig, rootPath, reader);
      selectedConfig = referenceSelection.config;
      diagnostics = [...diagnostics, ...referenceSelection.details];
      referenceOutcome = referenceSelection.outcome;
      status = nearest.ambiguous
        ? 'ambiguous'
        : referenceSelection.outcome === 'ambiguous'
          ? 'ambiguous'
          : referenceSelection.outcome === 'invalid' || baseConfig.status === 'invalid'
            ? 'invalid'
            : 'configured';
    } else {
      diagnostics.push('config-not-found');
    }

    const key = selectedConfig?.path ?? `fallback:${projectRoot}`;
    const group = groups.get(key) ?? { config: selectedConfig, status, roots: [], files: [], diagnostics: [] };
    group.roots.push(rootPath);
    group.files.push(rootPath);
    group.diagnostics.push(...diagnostics);
    if (status === 'invalid' || status === 'ambiguous') group.status = status;
    groups.set(key, group);
    referenceDiagnostics.push({ root: rootPath, configPath: selectedConfig?.path ?? null, outcome: referenceOutcome });
    projectDiagnostics.push({
      root: rootPath,
      configPath: selectedConfig?.path ?? null,
      configHash: selectedConfig
        ? createHash('sha256')
            .update(`${selectedConfig.text}\n${JSON.stringify(toPlainOptions(selectedConfig.parsed.options))}`)
            .digest('hex')
        : null,
      status,
      options: toPlainOptions(selectedConfig?.parsed.options ?? {}),
      diagnostics,
    });
  }

  for (const rootPath of eligibleFiles.slice(limits.maxRoots)) {
    projectDiagnostics.push({
      root: rootPath,
      configPath: null,
      configHash: null,
      status: 'invalid',
      options: {},
      diagnostics: ['compiler-root-budget-exhausted'],
    });
    referenceDiagnostics.push({ root: rootPath, configPath: null, outcome: 'budget-exhausted' });
  }

  const contexts: CompilerProjectContext[] = [];
  for (const group of groups.values()) {
    const compilerOptions: ts.CompilerOptions = group.config
      ? { ...group.config.parsed.options, noEmit: true }
      : {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.Latest,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          skipLibCheck: true,
          allowJs: true,
          noEmit: true,
        };
    const project = new Project({ compilerOptions, skipAddingFilesFromTsConfig: true });
    const assignedFiles = group.files.slice(0, limits.maxProjectFiles);
    reader.used.projectFiles += assignedFiles.length;
    if (group.files.length > assignedFiles.length) group.diagnostics.push('project-input-file-budget-exhausted');
    for (const filePath of assignedFiles) {
      try {
        const virtualSource = virtualSourceByPath.get(filePath);
        if (virtualSource !== undefined) project.createSourceFile(filePath, virtualSource, { overwrite: true });
        else project.addSourceFileAtPath(filePath);
      } catch {
        group.diagnostics.push(`project-source-unavailable:${relative(projectRoot, filePath)}`);
      }
    }
    const componentFiles = assignedFiles.filter((path) => {
      componentFilePattern.lastIndex = 0;
      return componentFilePattern.test(path);
    });
    contexts.push({
      root: group.roots[0] ?? projectRoot,
      configPath: group.config?.path ?? null,
      project,
      componentFiles,
      assignedFiles,
    });
  }

  const modules = contexts.flatMap(moduleDiagnostics);
  const fileDiscoveryDiagnostics = reader.diagnostics.filter(
    (item) => item === 'config-file-discovery-limited-to-explicit-input-roots',
  );
  const diagnostics: ExtractionDiagnostics = {
    schemaVersion: 1,
    projects: projectDiagnostics.map((project) =>
      project.configPath && fileDiscoveryDiagnostics.length > 0
        ? { ...project, diagnostics: [...new Set([...project.diagnostics, ...fileDiscoveryDiagnostics])] }
        : project,
    ),
    modules,
    references: referenceDiagnostics,
    coverage: 'partial',
    limits: { ...limits },
    used: {
      ...reader.used,
      roots: rootPaths.length,
      suppliedFiles: eligibleFiles.length,
      discoveredModules: modules.length,
      hiddenTypeScriptReads: 1,
    },
  };
  return { contexts, diagnostics };
}
