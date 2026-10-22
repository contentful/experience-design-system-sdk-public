import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { isAdmittedCompilerConfig, selectCompilerConfiguration } from '../src/compiler/configuration-policy.js';
import type {
  CaptureSourceEvidenceRequest,
  CapturedSourceFile,
  CapturedCompilerContext,
  SourceCapture,
  SourceCaptureDiagnostic,
  SourceCaptureLimits,
  SourceResolution,
  SourceCoverage,
} from './types.js';
import { DEFAULT_SOURCE_CAPTURE_LIMITS } from './types.js';
import { associateCapturedReferences } from './associate-references.js';
import { canonicalSelectedSourcePaths, discoverSourceEvidence } from './discovery.js';
import { readSourceInventory } from './discovery-validation.js';
import { canonicalSourceFactPath } from '../src/candidates/bind-source-candidates.js';

type ReadResult = { text: string; canonicalPath: string } | { reason: string; canonicalPath: string };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function isDependencyPath(root: string, candidate: string): boolean {
  return relative(root, candidate)
    .split(sep)
    .some((segment) => segment === 'node_modules' || segment === '.pnpm');
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
        specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const expression = node.expression;
      if (
        expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expression) && expression.text === 'require')
      ) {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return stableUnique(specifiers);
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    case '.json':
      return ts.ScriptKind.JSON;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasMatchingPathAlias(specifier: string, paths: Record<string, readonly string[]> | undefined): boolean {
  if (!paths) return false;
  return Object.keys(paths).some((pattern) => {
    const wildcard = pattern.indexOf('*');
    if (wildcard < 0) return pattern === specifier;
    const prefix = pattern.slice(0, wildcard);
    const suffix = pattern.slice(wildcard + 1);
    return (
      specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length
    );
  });
}

export async function captureSourceEvidence(request: CaptureSourceEvidenceRequest): Promise<SourceCapture> {
  const limits: SourceCaptureLimits = { ...DEFAULT_SOURCE_CAPTURE_LIMITS, ...request.limits };
  const inventory = structuredClone(
    request.inventory ??
      discoverSourceEvidence({
        projectRoot: request.projectRoot,
        filePaths: request.filePaths,
        evidenceFilePaths: request.evidenceFilePaths,
        limits: request.discoveryLimits,
        signal: request.signal,
      }),
  );
  const selectedSourcePaths =
    readSourceInventory(inventory).status === 'available'
      ? canonicalSelectedSourcePaths(inventory.projectRoot, inventory.selectedSourcePaths)
      : undefined;
  if (
    !selectedSourcePaths ||
    canonicalSourceFactPath(inventory.projectRoot) !== canonicalSourceFactPath(request.projectRoot) ||
    JSON.stringify(selectedSourcePaths) !==
      JSON.stringify(canonicalSelectedSourcePaths(request.projectRoot, request.filePaths))
  )
    throw new Error('Invalid source inventory or selected-root identity');
  const compilerSources = new Map(
    (request.compilerSources ?? []).map((source) => {
      let path = resolve(source.path);
      try {
        path = realpathSync.native(path);
      } catch {
        /* Preserve an unavailable compiler path. */
      }
      return [path, source] as const;
    }),
  );
  const startedAt = Date.now();
  const diagnostics: SourceCaptureDiagnostic[] = [];
  const filesByPath = new Map<string, CapturedSourceFile>();
  const readCache = new Map<string, ReadResult>();
  const roleSets = new Map<string, Set<string>>();
  const componentRefs = new Map<string, Map<string, { componentId: string; name: string; roles: string[] }>>();
  const resolutions: SourceResolution[] = [];
  const used = {
    files: 0,
    fileBytes: 0,
    totalBytes: 0,
    importDepth: 0,
    readAttempts: 0,
    resolverProbes: 0,
    captureMs: 0,
    promptBytes: 0,
    referenceNodes: 0,
  };
  let incomplete = false;
  let exhausted = false;

  const rootInput = isAbsolute(request.projectRoot) ? request.projectRoot : resolve(request.projectRoot);
  let projectRoot = resolve(rootInput);
  try {
    projectRoot = realpathSync.native(projectRoot);
  } catch {
    diagnostics.push({ kind: 'read', reason: 'project-root-unavailable' });
    incomplete = true;
  }

  const budgetCheck = (): boolean => {
    if (request.signal?.aborted) {
      const error = new Error('Source evidence capture was aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (Date.now() - startedAt > limits.maxCaptureMs) {
      diagnostics.push({ kind: 'budget', reason: 'max-capture-ms' });
      incomplete = true;
      exhausted = true;
      return false;
    }
    return true;
  };

  const candidatePath = (path: string): string => (isAbsolute(path) ? resolve(path) : resolve(projectRoot, path));
  const canonicalCandidate = (path: string): { path: string; excluded: boolean } => {
    let candidate = candidatePath(path);
    const suffix: string[] = [];
    let existing = candidate;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break;
      suffix.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      existing = parent;
    }
    try {
      candidate = resolve(realpathSync.native(existing), ...suffix);
    } catch {
      candidate = resolve(existing, ...suffix);
    }
    return { path: candidate, excluded: !isWithin(projectRoot, candidate) };
  };

  const readBounded = (path: string, configuration = false): ReadResult => {
    const canonical = canonicalCandidate(path);
    if (canonical.excluded && !configuration) {
      diagnostics.push({ kind: 'excluded', reason: `outside-project-root:${relative(projectRoot, canonical.path)}` });
      incomplete = true;
      return { canonicalPath: canonical.path, reason: 'excluded' };
    }
    if (isDependencyPath(projectRoot, canonical.path) && !compilerSources.has(canonical.path)) {
      const result: ReadResult = { canonicalPath: canonical.path, reason: 'external-dependency' };
      readCache.set(canonical.path, result);
      return result;
    }
    const cached = readCache.get(canonical.path);
    if (cached) return cached;
    if (!budgetCheck()) return { canonicalPath: canonical.path, reason: 'budget-exhausted' };
    if (used.readAttempts >= limits.maxReadAttempts) {
      diagnostics.push({ kind: 'budget', reason: 'max-read-attempts' });
      incomplete = true;
      exhausted = true;
      return { canonicalPath: canonical.path, reason: 'budget-exhausted' };
    }
    used.readAttempts += 1;
    let result: ReadResult;
    const compilerSource = compilerSources.get(canonical.path);
    if (compilerSource && sha256(compilerSource.content) !== compilerSource.textHash)
      throw new Error('Invalid compiler source hash');
    let filesystemText: string | undefined;
    let filesystemReason: string | undefined;
    try {
      const stat = statSync(canonical.path);
      if (!stat.isFile()) filesystemReason = 'not-a-file';
      else if (stat.size > limits.maxFileBytes) filesystemReason = 'max-file-bytes';
      else {
        filesystemText = readFileSync(canonical.path, 'utf8');
        const after = statSync(canonical.path);
        if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) {
          filesystemReason = 'source-changed-during-read';
          filesystemText = undefined;
        }
      }
    } catch {
      filesystemReason = 'unreadable';
    }
    if (compilerSource && filesystemText !== compilerSource.content) {
      diagnostics.push({
        kind: 'read',
        reason: `${filesystemReason ? 'filesystem-unavailable-compiler-snapshot-used' : 'filesystem-differs-from-compiler'}:${relative(projectRoot, canonical.path)}${filesystemReason ? ':' + filesystemReason : ''}`,
      });
      incomplete = true;
    }
    const text = compilerSource?.content ?? filesystemText;
    if (text === undefined) {
      result = { canonicalPath: canonical.path, reason: filesystemReason ?? 'unreadable' };
      diagnostics.push({ kind: 'read', reason: `${relative(projectRoot, canonical.path)}:${result.reason}` });
      incomplete = true;
    } else {
      const byteLength = Buffer.byteLength(text, 'utf8');
      if (byteLength > limits.maxFileBytes || used.totalBytes + byteLength > limits.maxTotalBytes) {
        result = {
          canonicalPath: canonical.path,
          reason: byteLength > limits.maxFileBytes ? 'max-file-bytes' : 'max-total-bytes',
        };
        diagnostics.push({ kind: 'budget', reason: result.reason });
        incomplete = true;
      } else {
        used.fileBytes += byteLength;
        used.totalBytes += byteLength;
        result = { canonicalPath: canonical.path, text };
        diagnostics.push({
          kind: 'read',
          reason: `${compilerSource ? 'compiler-loaded-bytes' : 'filesystem-fallback-bytes'}:${relative(projectRoot, canonical.path)}`,
        });
      }
    }
    readCache.set(canonical.path, result);
    return result;
  };

  const addRole = (path: string, role: string): void => {
    const current = roleSets.get(path) ?? new Set<string>();
    current.add(role);
    roleSets.set(path, current);
  };

  const addCapturedFile = (path: string, role: string): CapturedSourceFile | undefined => {
    const canonical = canonicalCandidate(path);
    const configuration =
      role === 'config' &&
      isAdmittedCompilerConfig(
        projectRoot,
        path,
        canonical.path,
        compilerSources.get(canonical.path)?.kind === 'config',
      );
    if (canonical.excluded && !configuration) {
      diagnostics.push({ kind: 'excluded', reason: `outside-project-root:${relative(projectRoot, canonical.path)}` });
      incomplete = true;
      return undefined;
    }
    addRole(canonical.path, role);
    const existing = filesByPath.get(canonical.path);
    if (existing) return existing;
    if (used.files >= limits.maxFiles) {
      diagnostics.push({ kind: 'budget', reason: 'max-files' });
      incomplete = true;
      exhausted = true;
      return undefined;
    }
    used.files += 1;
    const read = readBounded(canonical.path, configuration);
    const fileId = `src-${sha256(relative(projectRoot, canonical.path)).slice(0, 20)}`;
    const entry: CapturedSourceFile = {
      fileId,
      canonicalPath: canonical.path,
      displayPath: relative(projectRoot, canonical.path).split(sep).join('/'),
      textHash: 'text' in read ? sha256(read.text) : null,
      captured: 'text' in read ? { kind: 'full', text: read.text } : { kind: 'unavailable', reason: read.reason },
      roles: [],
      componentRefs: [],
    };
    filesByPath.set(canonical.path, entry);
    if (entry.captured.kind === 'full') return entry;
    incomplete = true;
    return entry;
  };

  const contexts = new Map<string, CapturedCompilerContext>();
  const contextsByDirectory = new Map<string, CapturedCompilerContext>();
  const configReferenceUsage = { references: 0 };
  const configExists = (path: string): boolean => {
    if (!budgetCheck() || used.resolverProbes >= limits.maxResolverProbes) {
      diagnostics.push({ kind: 'budget', reason: 'max-config-resolver-probes' });
      incomplete = true;
      exhausted = true;
      return false;
    }
    used.resolverProbes++;
    const canonical = canonicalCandidate(path);
    // Report an existing escaped config when the policy attempts to read it.
    if (isDependencyPath(projectRoot, canonical.path) && compilerSources.get(canonical.path)?.kind !== 'config')
      return false;
    if (compilerSources.get(canonical.path)?.kind === 'config') return true;
    try {
      return statSync(canonical.path).isFile();
    } catch {
      return false;
    }
  };
  const contextFor = (file: CapturedSourceFile): CapturedCompilerContext => {
    const directory = dirname(file.canonicalPath);
    const previous = contextsByDirectory.get(directory);
    if (previous) {
      file.compilerContextId = previous.contextId;
      return previous;
    }
    const configFiles = new Map<string, string | null>();
    const failures: string[] = [];
    const readConfig = (path: string): string | undefined => {
      const canonical = canonicalCandidate(path);
      if (
        !isAdmittedCompilerConfig(
          projectRoot,
          path,
          canonical.path,
          compilerSources.get(canonical.path)?.kind === 'config',
        )
      ) {
        failures.push('config-outside-admitted-source');
        return undefined;
      }
      const config = addCapturedFile(path, 'config');
      if (config) configFiles.set(config.fileId, config.textHash);
      if (!config || config.captured.kind !== 'full') {
        failures.push(
          `config-unreadable:${relative(projectRoot, canonical.path)}:${config?.captured.kind === 'unavailable' ? config.captured.reason : 'budget-exhausted'}`,
        );
        return undefined;
      }
      return config.captured.text;
    };
    const host: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: true,
      readDirectory: () => [], // Supplied admission owns source discovery.
      readFile: readConfig,
      fileExists: configExists,
    };
    const selected = selectCompilerConfiguration(
      file.canonicalPath,
      projectRoot,
      {
        readFile: readConfig,
        host,
        used: configReferenceUsage,
        canonicalizeConfigPath: (path) => canonicalCandidate(path).path,
        maxReferences: limits.maxResolverProbes,
        consumeReferences: (count) => {
          if (!budgetCheck() || used.resolverProbes + count > limits.maxResolverProbes) {
            diagnostics.push({ kind: 'budget', reason: 'max-config-reference-probes' });
            incomplete = true;
            exhausted = true;
            return false;
          }
          used.resolverProbes += count;
          return true;
        },
        explicitInputsOnly: true,
        admittedRelativeExtendsOnly: ![...compilerSources.values()].some((source) => source.kind === 'config'),
        shouldContinue: () => !exhausted && budgetCheck(),
      },
      configExists,
      limits.maxResolverProbes,
    );
    const compilerOptions: ts.CompilerOptions = {
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      ...selected.config?.parsed.options,
      // Analyze only admitted sources, without libraries, ambient packages or emission.
      noEmit: true,
      allowJs: true,
      checkJs: false,
      noLib: true,
      types: [],
      noResolve: false,
    };
    const contextData = {
      configPath: selected.config?.path ?? null,
      status: failures.length ? ('invalid' as const) : selected.status,
      referenceOutcome: exhausted ? ('budget-exhausted' as const) : selected.referenceOutcome,
      compilerOptions: JSON.parse(JSON.stringify(compilerOptions)) as Record<string, unknown>,
      configFiles: [...configFiles]
        .map(([fileId, textHash]) => ({ fileId, textHash }))
        .sort((a, b) => a.fileId.localeCompare(b.fileId)),
      diagnostics: [...new Set([...selected.diagnostics, ...failures])].sort(),
    };
    const contextId = `context-${sha256(JSON.stringify(contextData)).slice(0, 20)}`;
    const context = contexts.get(contextId) ?? { ...contextData, contextId };
    contexts.set(contextId, context);
    contextsByDirectory.set(directory, context);
    file.compilerContextId = contextId;
    for (const reason of context.diagnostics) {
      if (reason === 'config-not-found') continue; // Explicit fallback is preserved in context provenance.
      diagnostics.push({ kind: 'config', fileId: file.fileId, reason });
      incomplete = true;
    }
    if (context.referenceOutcome === 'cycle' || context.referenceOutcome === 'budget-exhausted') incomplete = true;
    return context;
  };

  let activeResolverFrom = '';
  const resolverHost: ts.ModuleResolutionHost = {
    fileExists(path) {
      if (used.resolverProbes >= limits.maxResolverProbes || !budgetCheck()) {
        if (used.resolverProbes >= limits.maxResolverProbes) {
          diagnostics.push({ kind: 'budget', reason: 'max-resolver-probes' });
          incomplete = true;
          exhausted = true;
        }
        return false;
      }
      used.resolverProbes += 1;
      const canonical = canonicalCandidate(path);
      if (canonical.excluded || isDependencyPath(projectRoot, canonical.path)) {
        diagnostics.push({
          kind: 'excluded',
          fileId: filesByPath.get(activeResolverFrom)?.fileId,
          reason: `resolver-outside-project-root:${relative(projectRoot, canonical.path)}`,
        });
        incomplete = true;
        return false;
      }
      try {
        return existsSync(canonical.path) && statSync(canonical.path).isFile();
      } catch {
        return false;
      }
    },
    readFile(path) {
      const read = readBounded(path);
      return 'text' in read ? read.text : undefined;
    },
    directoryExists(path) {
      if (used.resolverProbes >= limits.maxResolverProbes || !budgetCheck()) return false;
      used.resolverProbes += 1;
      const canonical = canonicalCandidate(path);
      if (canonical.excluded || isDependencyPath(projectRoot, canonical.path)) {
        incomplete = true;
        return false;
      }
      try {
        return statSync(canonical.path).isDirectory();
      } catch {
        return false;
      }
    },
    getCurrentDirectory: () => projectRoot,
    getDirectories: () => [],
    realpath(path) {
      return canonicalCandidate(path).path;
    },
  };

  const rootPaths = stableUnique([
    ...request.filePaths,
    ...inventory.files.map((file) => file.canonicalPath),
    ...[...compilerSources].filter(([, source]) => source.kind !== 'config').map(([path]) => path),
    ...(request.components ?? []).flatMap((component) => (component.sourcePath ? [component.sourcePath] : [])),
  ]).map((path) => canonicalCandidate(path));
  const componentPaths = new Map<string, Array<{ componentId: string; name: string }>>();
  for (const component of request.components ?? []) {
    if (!component.sourcePath) continue;
    const canonical = canonicalCandidate(component.sourcePath);
    if (canonical.excluded) continue;
    const values = componentPaths.get(canonical.path) ?? [];
    values.push({ componentId: component.componentId, name: component.name });
    componentPaths.set(canonical.path, values);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const resolveFile = (path: string, depth: number, role: string): void => {
    if (exhausted || !budgetCheck()) return;
    if (depth > limits.maxImportDepth) {
      diagnostics.push({ kind: 'budget', reason: 'max-import-depth' });
      incomplete = true;
      exhausted = true;
      return;
    }
    used.importDepth = Math.max(used.importDepth, depth);
    const canonical = canonicalCandidate(path);
    if (canonical.excluded) {
      diagnostics.push({ kind: 'excluded', reason: `outside-project-root:${relative(projectRoot, canonical.path)}` });
      incomplete = true;
      return;
    }
    const captured = addCapturedFile(canonical.path, role);
    if (!captured) return;
    const contents = captured.captured.kind === 'full' ? captured.captured.text : undefined;
    if (contents === undefined) return;
    if (visiting.has(canonical.path)) return;
    if (visited.has(canonical.path)) return;
    const context = contextFor(captured);
    if (!/\.[cm]?[jt]sx?$/.test(canonical.path)) return;
    const compilerOptions = context.compilerOptions as ts.CompilerOptions;
    const configAliasPaths = compilerOptions.paths;
    visiting.add(canonical.path);
    const sourceFile = ts.createSourceFile(
      canonical.path,
      contents,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(canonical.path),
    );
    const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
      .parseDiagnostics;
    if (parseDiagnostics.length > 0) {
      diagnostics.push({
        kind: 'parse',
        fileId: captured.fileId,
        reason: `typescript-parse-errors:${parseDiagnostics.length}`,
      });
      incomplete = true;
    }
    activeResolverFrom = canonical.path;
    for (const specifier of moduleSpecifiers(sourceFile)) {
      if (exhausted) break;
      if (!budgetCheck()) break;
      if (specifier.startsWith('node:')) {
        resolutions.push({ fromFileId: captured.fileId, specifier, outcome: 'external', reason: 'node-builtin' });
        incomplete = true;
        continue;
      }
      if (specifier.startsWith('.') || isAbsolute(specifier)) {
        const requestedPath = canonicalCandidate(resolve(dirname(canonical.path), specifier));
        if (requestedPath.excluded || isDependencyPath(projectRoot, requestedPath.path)) {
          resolutions.push({
            fromFileId: captured.fileId,
            specifier,
            outcome: 'excluded',
            reason: 'outside-project-root',
          });
          incomplete = true;
          continue;
        }
      }
      activeResolverFrom = canonical.path;
      const result = ts.resolveModuleName(specifier, canonical.path, compilerOptions, resolverHost);
      const resolvedPath = result.resolvedModule?.resolvedFileName;
      if (!resolvedPath) {
        if (exhausted) {
          resolutions.push({
            fromFileId: captured.fileId,
            specifier,
            outcome: 'budget-exhausted',
            reason: 'resolver-budget',
          });
          incomplete = true;
        } else if (hasMatchingPathAlias(specifier, configAliasPaths)) {
          resolutions.push({
            fromFileId: captured.fileId,
            specifier,
            outcome: 'unresolved',
            reason: 'configured-alias-not-found',
          });
          incomplete = true;
        } else if (specifier.startsWith('.') || isAbsolute(specifier)) {
          resolutions.push({
            fromFileId: captured.fileId,
            specifier,
            outcome: 'unresolved',
            reason: 'module-not-found',
          });
          incomplete = true;
        } else {
          resolutions.push({
            fromFileId: captured.fileId,
            specifier,
            outcome: 'external',
            reason: 'package-not-captured',
          });
          incomplete = true;
        }
        continue;
      }
      const resolved = canonicalCandidate(resolvedPath);
      if (resolved.excluded || isDependencyPath(projectRoot, resolved.path)) {
        resolutions.push({
          fromFileId: captured.fileId,
          specifier,
          outcome: 'excluded',
          reason: 'outside-project-root',
        });
        incomplete = true;
        continue;
      }
      const target = filesByPath.get(resolved.path);
      if (visiting.has(resolved.path)) {
        resolutions.push({
          fromFileId: captured.fileId,
          specifier,
          outcome: 'cycle',
          ...(target ? { targetFileId: target.fileId } : {}),
          reason: 'cycle-edge',
        });
        incomplete = true;
        continue;
      }
      const targetFile = addCapturedFile(resolved.path, 'import');
      if (!targetFile) {
        resolutions.push({
          fromFileId: captured.fileId,
          specifier,
          outcome: 'budget-exhausted',
          reason: 'capture-file-budget',
        });
        incomplete = true;
        continue;
      }
      resolutions.push({
        fromFileId: captured.fileId,
        specifier,
        outcome: targetFile.captured.kind === 'full' ? 'resolved' : 'unreadable',
        targetFileId: targetFile.fileId,
      });
      resolveFile(resolved.path, depth + 1, 'import');
    }
    visiting.delete(canonical.path);
    visited.add(canonical.path);
  };

  for (const root of rootPaths) {
    if (root.excluded) {
      diagnostics.push({ kind: 'excluded', reason: `entry-outside-project-root:${relative(projectRoot, root.path)}` });
      incomplete = true;
      continue;
    }
    const componentMatches = componentPaths.get(root.path) ?? [];
    const roles =
      componentMatches.length > 0
        ? ['definition']
        : selectedSourcePaths.includes(root.path)
          ? ['entrypoint']
          : ['evidence'];
    for (const role of roles) resolveFile(root.path, 0, role);
  }

  for (const component of request.components ?? []) {
    if (!component.sourcePath) continue;
    const canonical = canonicalCandidate(component.sourcePath);
    const captured = filesByPath.get(canonical.path);
    if (!captured) continue;
    const refs = componentRefs.get(canonical.path) ?? new Map();
    refs.set(component.componentId, {
      componentId: component.componentId,
      name: component.name,
      roles: ['definition'],
    });
    componentRefs.set(canonical.path, refs);
  }

  for (const [path, file] of filesByPath) {
    file.roles = stableUnique([...(roleSets.get(path) ?? [])]);
    file.componentRefs = [...(componentRefs.get(path)?.values() ?? [])].sort((left, right) =>
      left.componentId.localeCompare(right.componentId),
    );
  }
  used.captureMs = Date.now() - startedAt;
  const files = [...filesByPath.values()].sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  const associationDiagnostics = associateCapturedReferences({
    files,
    resolution: resolutions,
    compilerContexts: [...contexts.values()],
    componentPaths,
    checkBudget: budgetCheck,
    maxNodes: limits.maxReferenceNodes ?? 100_000,
    recordNodes: (nodes) => {
      used.referenceNodes = nodes;
    },
  });
  if (associationDiagnostics.length) {
    diagnostics.push(...associationDiagnostics);
    incomplete = true;
  }
  used.captureMs = Date.now() - startedAt;
  const sortedResolutions = resolutions.sort(
    (left, right) =>
      left.fromFileId.localeCompare(right.fromFileId) ||
      left.specifier.localeCompare(right.specifier) ||
      left.outcome.localeCompare(right.outcome),
  );
  diagnostics.sort(
    (left, right) =>
      (left.fileId ?? '').localeCompare(right.fileId ?? '') ||
      left.kind.localeCompare(right.kind) ||
      left.reason.localeCompare(right.reason),
  );
  const coverage: SourceCoverage =
    files.every((file) => file.captured.kind !== 'unavailable') && files.length > 0
      ? incomplete || sortedResolutions.some((item) => item.outcome !== 'resolved')
        ? 'partial'
        : 'complete-within-declared-bound'
      : files.length === 0 || files.every((file) => file.captured.kind === 'unavailable')
        ? 'unavailable'
        : 'partial';
  const captureWithoutIdentity = {
    inventory,
    schemaVersion: 1 as const,
    projectRoot,
    files,
    compilerContexts: [...contexts.values()].sort((a, b) => a.contextId.localeCompare(b.contextId)),
    resolution: sortedResolutions,
    diagnostics,
    bounds: { limits, used },
    coverage,
    extractionByteBinding: 'unverified' as const,
  };
  const captureId = `capture-${randomUUID()}`;
  const payload = { ...captureWithoutIdentity, captureId };
  const digest = sha256(JSON.stringify(payload));
  return { ...payload, digest };
}
