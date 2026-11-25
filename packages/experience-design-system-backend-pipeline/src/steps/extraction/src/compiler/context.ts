import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Project } from 'ts-morph';
import ts from 'typescript';
import { profileImportSync } from '../../../../profiling/import-profile.js';
import type {
  CompilerModuleDiagnostic,
  CompilerProjectDiagnostic,
  CompilerReferenceDiagnostic,
  ExtractionDiagnostics,
} from '../candidates/types.js';
import type { ExtractorOptions } from '../types/options.js';
import {
  formatDiagnostic,
  isAdmittedCompilerConfig,
  selectCompilerConfiguration,
  type ParsedConfig,
} from './configuration-policy.js';
import { createExplicitSourceDirectoryReader } from './explicit-source-directory.js';
import {
  createObservedCompilerFileSystem,
  COMPILER_READ_LIMITS,
  type CompilerFileSystemSnapshot,
} from './observed-file-system.js';
import { canonicalSourceFactPath } from '../candidates/bind-source-candidates.js';
import {
  DEFAULT_SOURCE_DISCOVERY_LIMITS,
  discoverSourceEvidence,
  isWithinEvidenceRoot as isWithin,
  type SourceEvidenceInventory,
} from '../../source-evidence/discovery.js';

const DEFAULT_LIMITS = {
  maxRoots: 256,
  maxConfigReads: 256,
  maxConfigFileBytes: 256 * 1024,
  maxLoadedSourceBytes: 256 * 1024,
  maxTotalLoadedSourceBytes: 8 * 1024 * 1024,
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
  configSources?: CompilerLoadedSource[];
}

export interface CompilerContextResult {
  contexts: CompilerProjectContext[];
  diagnostics: ExtractionDiagnostics;
  sourceInventory: SourceEvidenceInventory;
}
export interface CompilerLoadedSource {
  path: string;
  content: string;
  textHash: string;
  configPath: string | null;
  kind?: 'config';
}
export function createCompilerSourceCollector(inventory?: SourceEvidenceInventory) {
  const sources = new Map<string, CompilerLoadedSource>();
  let bytes = 0;
  const add = (context: CompilerProjectContext): void => {
    for (const source of context.configSources ?? []) sources.set(source.path, source);
    let program: ts.Program;
    try {
      program = context.project.getProgram().compilerObject;
    } catch {
      if (inventory) {
        inventory.omissions.push({ path: context.root, reason: 'compiler-loaded-source-program-unavailable' });
        inventory.coverage = 'partial';
      }
      return;
    }
    for (const file of program.getSourceFiles()) {
      if (program.isSourceFileDefaultLibrary(file)) continue;
      const path = canonicalCompilerPath(file.fileName);
      const size = Buffer.byteLength(file.text);
      if (sources.has(path)) {
        if (sources.get(path)!.textHash !== createHash('sha256').update(file.text).digest('hex'))
          inventory?.omissions.push({ path, reason: 'compiler-context-byte-conflict' });
        continue;
      }
      if (size > DEFAULT_LIMITS.maxLoadedSourceBytes || bytes + size > DEFAULT_LIMITS.maxTotalLoadedSourceBytes) {
        inventory?.omissions.push({ path, reason: 'compiler-loaded-source-byte-budget' });
        continue;
      }
      sources.set(path, {
        path,
        content: file.text,
        textHash: createHash('sha256').update(file.text).digest('hex'),
        configPath: context.configPath,
      });
      bytes += size;
    }
  };
  return { add, sources: () => [...sources.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

export function compilerSourcesFromContexts(
  contexts: readonly CompilerProjectContext[],
  inventory?: SourceEvidenceInventory,
): CompilerLoadedSource[] {
  const collector = createCompilerSourceCollector(inventory);
  for (const context of contexts) collector.add(context);
  return collector.sources();
}
function canonicalCompilerPath(path: string): string {
  return canonicalSourceFactPath(path);
}

export interface VirtualCompilerSource {
  path: string;
  content: string;
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
  }
  return common;
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
  const selectedConfigPaths = new Set<string>();
  const used = { configReads: 0, configBytes: 0, directoryEntries: 0, references: 0, projectFiles: 0 };

  const readFile = (path: string): string | undefined => {
    const canonicalPath = canonicalCompilerPath(path);
    if (signal?.aborted) {
      diagnostics.push('config-analysis-cancelled');
      return undefined;
    }
    if (!isAdmittedCompilerConfig(projectRoot, path, canonicalPath, true)) {
      diagnostics.push(`config-outside-admitted-source:${relative(projectRoot, canonicalPath)}`);
      return undefined;
    }
    selectedConfigPaths.add(canonicalPath);
    const cached = reads.get(canonicalPath);
    if (cached !== undefined) return cached ?? undefined;
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

  const readDirectory = createExplicitSourceDirectoryReader(explicitRoots);
  const host: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => projectRoot,
    fileExists: (path) => readFile(path) !== undefined,
    readFile,
    readDirectory: (root, extensions, excludes, includes, depth) => {
      diagnostics.push('config-file-discovery-limited-to-explicit-input-roots');
      const candidates = readDirectory(root, extensions, excludes, includes, depth);
      const remaining = Math.max(0, limits.maxDirectoryEntries - used.directoryEntries);
      used.directoryEntries += Math.min(candidates.length, remaining);
      if (candidates.length > remaining) diagnostics.push('config-directory-entry-budget-exhausted');
      return candidates.slice(0, remaining);
    },
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => diagnostics.push(formatDiagnostic(diagnostic)),
  };

  return {
    host,
    readFile,
    reads,
    hashByPath,
    diagnostics,
    used,
    selectedConfigPaths,
    canonicalizeConfigPath: canonicalCompilerPath,
    explicitInputsOnly: true,
    shouldContinue: () => !signal?.aborted,
  };
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

function discoverCompilerSourceInventory(
  projectRoot: string,
  filePaths: readonly string[],
  options: ExtractorOptions,
): SourceEvidenceInventory {
  if (!options.signal?.aborted) {
    try {
      return discoverSourceEvidence({
        projectRoot,
        filePaths,
        evidenceFilePaths: options.evidenceFilePaths,
        signal: options.signal,
      });
    } catch (error) {
      if (!options.signal?.aborted || !(error instanceof Error) || error.name !== 'AbortError') throw error;
    }
  }
  return {
    schemaVersion: 1,
    projectRoot,
    selectedSourcePaths: [...new Set(filePaths.map(canonicalCompilerPath))].sort(),
    files: [],
    packages: [],
    sourceMaps: [],
    omissions: [{ path: projectRoot, reason: 'source-discovery-aborted' }],
    coverage: 'unavailable',
    bounds: {
      limits: { ...DEFAULT_SOURCE_DISCOVERY_LIMITS },
      used: { files: 0, totalBytes: 0, directories: 0, directoryEntries: 0, readAttempts: 0, depth: 0, discoveryMs: 0 },
    },
  };
}

type CompilerContextConsumer = (
  context: CompilerProjectContext,
  diagnostics: ExtractionDiagnostics,
  sourceInventory: SourceEvidenceInventory,
) => void;

export function createCompilerContexts(
  filePaths: readonly string[],
  componentFilePattern: RegExp,
  options: ExtractorOptions = {},
  virtualSources: readonly VirtualCompilerSource[] = [],
): CompilerContextResult {
  return buildCompilerContexts(filePaths, componentFilePattern, options, virtualSources);
}

export function forEachCompilerContext(
  filePaths: readonly string[],
  componentFilePattern: RegExp,
  options: ExtractorOptions,
  consume: CompilerContextConsumer,
  virtualSources: readonly VirtualCompilerSource[] = [],
  componentOrder?: readonly string[],
): Omit<CompilerContextResult, 'contexts'> {
  const { diagnostics, sourceInventory } = buildCompilerContexts(
    filePaths,
    componentFilePattern,
    options,
    virtualSources,
    consume,
    componentOrder,
  );
  return { diagnostics, sourceInventory };
}

function buildCompilerContexts(
  filePaths: readonly string[],
  componentFilePattern: RegExp,
  options: ExtractorOptions,
  virtualSources: readonly VirtualCompilerSource[],
  consume?: CompilerContextConsumer,
  componentOrder?: readonly string[],
): CompilerContextResult {
  const projectRoot = canonicalCompilerPath(options.projectRoot ?? commonDirectory(filePaths));
  const limits = DEFAULT_LIMITS;
  const sourceInventory = discoverCompilerSourceInventory(projectRoot, filePaths, options);
  const selectedFiles = new Set(filePaths.map(canonicalCompilerPath));
  const eligibleFiles = [...selectedFiles]
    .sort()
    .concat(
      sourceInventory.files
        .filter((file) => /\.[cm]?[jt]sx?$/.test(file.canonicalPath) && !selectedFiles.has(file.canonicalPath))
        .map((file) => file.canonicalPath),
    );
  const rootPaths = eligibleFiles.slice(0, limits.maxRoots);
  const reader = makeCompilerHost(projectRoot, limits, rootPaths, options.signal);
  const observed = createObservedCompilerFileSystem(projectRoot, options.signal);
  const virtualSourceByPath = new Map(
    virtualSources.map((source) => [canonicalCompilerPath(source.path), source.content]),
  );
  const groups = new Map<
    string,
    {
      config: ParsedConfig | null;
      status: CompilerProjectDiagnostic['status'];
      roots: string[];
      files: string[];
      diagnostics: string[];
      configSources: Map<string, CompilerLoadedSource>;
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
    reader.selectedConfigPaths.clear();
    const selection = selectCompilerConfiguration(rootPath, projectRoot, reader, existsSync, limits.maxConfigReads);
    const selectedConfig = selection.config;
    const { status, referenceOutcome } = selection;
    const diagnostics = [...new Set([...selection.diagnostics, ...reader.diagnostics.slice(readerDiagnosticStart)])];

    const key = selectedConfig?.path ?? `fallback:${projectRoot}`;
    const group: NonNullable<ReturnType<typeof groups.get>> = groups.get(key) ?? {
      config: selectedConfig,
      status,
      roots: [],
      files: [],
      diagnostics: [],
      configSources: new Map(),
    };
    for (const path of reader.selectedConfigPaths) {
      const content = reader.reads.get(path);
      const textHash = reader.hashByPath.get(path);
      if (content !== null && content !== undefined && textHash)
        group.configSources.set(path, {
          path,
          content,
          textHash,
          configPath: selectedConfig?.path ?? null,
          kind: 'config',
        });
    }
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
  const diagnostics: ExtractionDiagnostics = {
    schemaVersion: 1,
    reads: observed.reads,
    projects: projectDiagnostics,
    modules: [],
    references: referenceDiagnostics,
    coverage: 'partial',
    limits: { ...limits, ...COMPILER_READ_LIMITS },
    used: Object.assign(observed.used, {
      ...reader.used,
      roots: rootPaths.length,
      suppliedFiles: eligibleFiles.length,
      discoveredModules: 0,
      hiddenTypeScriptReads: 0,
    }),
  };
  type CompilerGroup = NonNullable<ReturnType<typeof groups.get>>;
  const buildContext = (group: CompilerGroup, recordMetrics: boolean): CompilerProjectContext => {
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
    if (recordMetrics) reader.used.projectFiles += assignedFiles.length;
    if (recordMetrics && group.files.length > assignedFiles.length)
      group.diagnostics.push('project-input-file-budget-exhausted');
    for (const filePath of assignedFiles) {
      try {
        const virtualSource = virtualSourceByPath.get(filePath);
        if (virtualSource !== undefined) project.createSourceFile(filePath, virtualSource, { overwrite: true });
        else project.addSourceFileAtPath(filePath);
      } catch (error) {
        if (recordMetrics) group.diagnostics.push(`project-source-unavailable:${relative(projectRoot, filePath)}`);
        if (recordMetrics)
          group.diagnostics.push(`project-source-error:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let optionDiagnostics: string[];
    try {
      optionDiagnostics = project.getProgram().compilerObject.getOptionsDiagnostics().map(formatDiagnostic);
    } catch {
      optionDiagnostics = ['compiler-options-read-unavailable'];
    }
    if (recordMetrics && optionDiagnostics.length) group.status = 'invalid';
    if (recordMetrics) group.diagnostics.push(...optionDiagnostics);
    if (recordMetrics)
      for (const receipt of projectDiagnostics.filter((receipt) => group.roots.includes(receipt.root))) {
        receipt.diagnostics = [...new Set([...receipt.diagnostics, ...group.diagnostics])];
        if (optionDiagnostics.length) receipt.status = 'invalid';
        receipt.options = toPlainOptions(compilerOptions);
      }
    const componentFiles = assignedFiles.filter((path) => {
      componentFilePattern.lastIndex = 0;
      return selectedFiles.has(path) && componentFilePattern.test(path);
    });
    return {
      root: group.roots[0] ?? projectRoot,
      configPath: group.config?.path ?? null,
      project,
      componentFiles,
      assignedFiles,
      configSources: [...group.configSources.values()],
    };
  };
  const compilerModules: CompilerModuleDiagnostic[] = [];
  const prepared: Array<{
    group: CompilerGroup;
    snapshot?: CompilerFileSystemSnapshot;
    original?: CompilerProjectContext;
    componentFiles: string[];
  }> = [];
  const reuseOriginal = groups.size === 1;
  const markCancelled = (group: CompilerGroup) => {
    for (const root of group.roots) {
      diagnostics.modules.push({
        specifier: 'compiler-analysis',
        fromPath: root,
        outcome: 'unavailable',
        reason: 'compiler-analysis-cancelled',
      });
      const receipt = diagnostics.projects.find((item) => item.root === root);
      if (receipt) {
        receipt.status = 'invalid';
        receipt.diagnostics.push('compiler-analysis-aborted');
      }
    }
  };
  let discoveredModules = 0;
  for (const group of groups.values()) {
    if (consume && options.signal?.aborted) {
      markCancelled(group);
      continue;
    }
    const create = () => {
      const context = profileImportSync('compiler.program.create', () => buildContext(group, true), {
        workerRole: 'compiler',
        fileCount: group.files.length,
      });
      return { context, modules: profileImportSync('compiler.module-diagnostics', () => moduleDiagnostics(context)) };
    };
    if (consume && reuseOriginal) {
      const created = create();
      compilerModules.push(...created.modules);
      discoveredModules += created.modules.length;
      prepared.push({ group, original: created.context, componentFiles: created.context.componentFiles });
    } else if (consume) {
      const captured = observed.captureSnapshot(create);
      compilerModules.push(...captured.value.modules);
      discoveredModules += captured.value.modules.length;
      prepared.push({ group, snapshot: captured.snapshot, componentFiles: captured.value.context.componentFiles });
    } else {
      const created = create();
      compilerModules.push(...created.modules);
      discoveredModules += created.modules.length;
      contexts.push(created.context);
    }
  }

  diagnostics.modules = [...compilerModules, ...diagnostics.modules];
  const fileDiscoveryDiagnostics = reader.diagnostics.filter(
    (item) => item === 'config-file-discovery-limited-to-explicit-input-roots',
  );
  diagnostics.projects = projectDiagnostics.map((project) =>
    project.configPath && fileDiscoveryDiagnostics.length > 0
      ? { ...project, diagnostics: [...new Set([...project.diagnostics, ...fileDiscoveryDiagnostics])] }
      : project,
  );
  Object.assign(diagnostics.used, { ...reader.used, discoveredModules });
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
      path: canonicalCompilerPath(source.path),
      kind: 'virtual',
      textHash: createHash('sha256').update(source.content).digest('hex'),
      byteLength: Buffer.byteLength(source.content, 'utf8'),
      outcome: 'read',
      reason: null,
    });
  if (consume) {
    const plan: Array<{ prepared: (typeof prepared)[number]; componentFiles: string[] }> = [];
    if (componentOrder) {
      const byPath = new Map(prepared.flatMap((entry) => entry.componentFiles.map((path) => [path, entry] as const)));
      for (const path of componentOrder.map(canonicalCompilerPath)) {
        const entry = byPath.get(path);
        if (!entry) continue;
        const prior = plan[plan.length - 1];
        if (prior?.prepared === entry) prior.componentFiles.push(path);
        else plan.push({ prepared: entry, componentFiles: [path] });
      }
    } else for (const entry of prepared) plan.push({ prepared: entry, componentFiles: entry.componentFiles });
    const remaining = new Map<(typeof prepared)[number], number>();
    for (const item of plan) remaining.set(item.prepared, (remaining.get(item.prepared) ?? 0) + 1);
    const active = new Map<(typeof prepared)[number], CompilerProjectContext>();
    try {
      for (const item of plan) {
        if (options.signal?.aborted) {
          active.clear();
          markCancelled(item.prepared.group);
          continue;
        }
        const context =
          item.prepared.original ??
          active.get(item.prepared) ??
          profileImportSync(
            'compiler.program.reconstruct',
            () =>
              observed.replaySnapshot(item.prepared.snapshot!, () => {
                const replayed = buildContext(item.prepared.group, false);
                profileImportSync('compiler.module-diagnostics', () => moduleDiagnostics(replayed));
                return replayed;
              }),
            { workerRole: 'compiler', fileCount: item.prepared.group.files.length },
          );
        context.componentFiles = item.componentFiles;
        profileImportSync('compiler.context.consume', () => consume(context, diagnostics, sourceInventory), {
          workerRole: 'compiler',
          fileCount: context.componentFiles.length,
        });
        const left = remaining.get(item.prepared)! - 1;
        remaining.set(item.prepared, left);
        if (left) active.set(item.prepared, context);
        else {
          active.delete(item.prepared);
          item.prepared.original = undefined;
        }
      }
    } finally {
      active.clear();
      for (const entry of prepared) entry.original = undefined;
    }
  }
  return { contexts, diagnostics, sourceInventory };
}
