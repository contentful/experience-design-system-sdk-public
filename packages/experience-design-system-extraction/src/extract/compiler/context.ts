import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
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
import { selectCompilerConfiguration, type ParsedConfig } from './configuration-policy.js';
import { createObservedCompilerFileSystem, COMPILER_READ_LIMITS } from './observed-file-system.js';

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

function makeCompilerHost(
  projectRoot: string,
  limits: typeof DEFAULT_LIMITS,
  explicitRoots: readonly string[],
  signal?: AbortSignal,
) {
  const reads = new Map<string, string | null>();
  const hashByPath = new Map<string, string>();
  const diagnostics: string[] = [];
  const used = { configReads: 0, configBytes: 0, directoryEntries: 0, references: 0, projectFiles: 0 };

  const readFile = (path: string): string | undefined => {
    const canonicalPath = resolve(path);
    if (signal?.aborted) {
      diagnostics.push('config-analysis-cancelled');
      return undefined;
    }
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
    let fd: number | undefined;
    try {
      fd = openSync(canonicalPath, 'r');
      const stat = fstatSync(fd);
      if (!stat.isFile()) {
        reads.set(canonicalPath, null);
        return undefined;
      }
      if (stat.size > limits.maxConfigFileBytes || used.configBytes + stat.size > limits.maxConfigBytes) {
        diagnostics.push(`config-byte-budget-exhausted:${relative(projectRoot, canonicalPath)}`);
        reads.set(canonicalPath, null);
        return undefined;
      }
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        if (signal?.aborted) {
          diagnostics.push('config-analysis-cancelled');
          reads.set(canonicalPath, null);
          return undefined;
        }
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) break;
        offset += count;
        used.configBytes += count;
      }
      const after = fstatSync(fd);
      if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
        diagnostics.push(`config-source-changed-during-read:${relative(projectRoot, canonicalPath)}`);
        reads.set(canonicalPath, null);
        return undefined;
      }
      const text = bytes.toString('utf8');
      hashByPath.set(canonicalPath, createHash('sha256').update(text).digest('hex'));
      reads.set(canonicalPath, text);
      return text;
    } catch {
      reads.set(canonicalPath, null);
      return undefined;
    } finally {
      if (fd !== undefined) closeSync(fd);
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
  const reader = makeCompilerHost(projectRoot, limits, rootPaths, options.signal);
  const observed = createObservedCompilerFileSystem(projectRoot, options.signal);
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
    const readerDiagnosticStart = reader.diagnostics.length;
    const selection = selectCompilerConfiguration(rootPath, projectRoot, reader, existsSync, limits.maxConfigReads);
    const selectedConfig = selection.config;
    const { status, referenceOutcome } = selection;
    const diagnostics = [...new Set([...selection.diagnostics, ...reader.diagnostics.slice(readerDiagnosticStart)])];

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
    const project = new Project({
      compilerOptions,
      skipAddingFilesFromTsConfig: true,
      fileSystem: observed.host,
      libFolderPath: dirname(ts.sys.getExecutingFilePath()),
    });
    const assignedFiles = group.files.slice(0, limits.maxProjectFiles);
    reader.used.projectFiles += assignedFiles.length;
    if (group.files.length > assignedFiles.length) group.diagnostics.push('project-input-file-budget-exhausted');
    for (const filePath of assignedFiles) {
      try {
        const virtualSource = virtualSourceByPath.get(filePath);
        if (virtualSource !== undefined) project.createSourceFile(filePath, virtualSource, { overwrite: true });
        else project.addSourceFileAtPath(filePath);
      } catch (error) {
        group.diagnostics.push(`project-source-unavailable:${relative(projectRoot, filePath)}`);
        group.diagnostics.push(`project-source-error:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let optionDiagnostics: string[];
    try {
      optionDiagnostics = project.getProgram().compilerObject.getOptionsDiagnostics().map(formatDiagnostic);
    } catch {
      optionDiagnostics = ['compiler-options-read-unavailable'];
    }
    if (optionDiagnostics.length) group.status = 'invalid';
    group.diagnostics.push(...optionDiagnostics);
    for (const receipt of projectDiagnostics.filter((receipt) => group.roots.includes(receipt.root))) {
      receipt.diagnostics = [...new Set([...receipt.diagnostics, ...group.diagnostics])];
      if (optionDiagnostics.length) receipt.status = 'invalid';
      receipt.options = toPlainOptions(compilerOptions);
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
    reads: observed.reads,
    projects: projectDiagnostics.map((project) =>
      project.configPath && fileDiscoveryDiagnostics.length > 0
        ? { ...project, diagnostics: [...new Set([...project.diagnostics, ...fileDiscoveryDiagnostics])] }
        : project,
    ),
    modules,
    references: referenceDiagnostics,
    coverage: 'partial',
    limits: { ...limits, ...COMPILER_READ_LIMITS },
    used: Object.assign(observed.used, {
      ...reader.used,
      roots: rootPaths.length,
      suppliedFiles: eligibleFiles.length,
      discoveredModules: modules.length,
      hiddenTypeScriptReads: 0,
    }),
  };
  for (const [path, textHash] of reader.hashByPath)
    diagnostics.reads!.push({
      path,
      kind: 'config',
      textHash,
      byteLength: Buffer.byteLength(reader.readFile(path) ?? '', 'utf8'),
      outcome: 'read',
      reason: null,
    });
  for (const source of virtualSources)
    diagnostics.reads!.push({
      path: resolve(source.path),
      kind: 'virtual',
      textHash: createHash('sha256').update(source.content).digest('hex'),
      byteLength: Buffer.byteLength(source.content, 'utf8'),
      outcome: 'read',
      reason: null,
    });
  return { contexts, diagnostics };
}
