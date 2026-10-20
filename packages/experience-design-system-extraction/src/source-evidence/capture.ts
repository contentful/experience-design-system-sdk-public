import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import type {
  CaptureSourceEvidenceRequest,
  CapturedSourceFile,
  SourceCapture,
  SourceCaptureDiagnostic,
  SourceCaptureLimits,
  SourceResolution,
  SourceCoverage,
} from './types.js';
import { DEFAULT_SOURCE_CAPTURE_LIMITS } from './types.js';
import { associateCapturedReferences } from './associate-references.js';

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

  const readBounded = (path: string): ReadResult => {
    const canonical = canonicalCandidate(path);
    if (canonical.excluded) {
      diagnostics.push({ kind: 'excluded', reason: `outside-project-root:${relative(projectRoot, canonical.path)}` });
      incomplete = true;
      return { canonicalPath: canonical.path, reason: 'excluded' };
    }
    if (isDependencyPath(projectRoot, canonical.path)) {
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
    try {
      const stat = statSync(canonical.path);
      if (!stat.isFile()) {
        result = { canonicalPath: canonical.path, reason: 'not-a-file' };
      } else if (stat.size > limits.maxFileBytes) {
        result = { canonicalPath: canonical.path, reason: 'max-file-bytes' };
        diagnostics.push({ kind: 'budget', reason: `max-file-bytes:${relative(projectRoot, canonical.path)}` });
        incomplete = true;
      } else if (used.totalBytes + stat.size > limits.maxTotalBytes) {
        result = { canonicalPath: canonical.path, reason: 'max-total-bytes' };
        diagnostics.push({ kind: 'budget', reason: 'max-total-bytes' });
        incomplete = true;
        exhausted = true;
      } else {
        const text = readFileSync(canonical.path, 'utf8');
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
        }
      }
    } catch (error) {
      result = { canonicalPath: canonical.path, reason: 'unreadable' };
      diagnostics.push({
        kind: 'read',
        reason: `${relative(projectRoot, canonical.path)}:${error instanceof Error ? error.name : 'read-error'}`,
      });
      incomplete = true;
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
    if (canonical.excluded) {
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
    const read = readBounded(canonical.path);
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

  let configuredOptions: ts.CompilerOptions = {};
  const readConfig = (path: string): string | undefined => {
    const canonical = canonicalCandidate(path);
    if (canonical.excluded || isDependencyPath(projectRoot, canonical.path)) {
      diagnostics.push({ kind: 'config', reason: 'config-outside-admitted-source' });
      incomplete = true;
      return undefined;
    }
    const read = readBounded(canonical.path);
    if (!('text' in read)) {
      diagnostics.push({ kind: 'config', reason: `config-unreadable:${relative(projectRoot, canonical.path)}` });
      incomplete = true;
      return undefined;
    }
    addCapturedFile(canonical.path, 'config');
    const config = ts.parseConfigFileTextToJson(canonical.path, read.text);
    if (config.error) {
      diagnostics.push({ kind: 'config', reason: `config-parse:${relative(projectRoot, canonical.path)}` });
      incomplete = true;
    }
    const extended = config.config?.extends as unknown;
    const extendsValues = typeof extended === 'string' ? [extended] : Array.isArray(extended) ? extended : [];
    for (const value of extendsValues)
      if (typeof value === 'string' && !value.startsWith('.') && !isAbsolute(value)) {
        diagnostics.push({ kind: 'config', reason: `unsupported-package-config-extends:${value}` });
        incomplete = true;
      }
    return read.text;
  };
  const tsConfig = resolve(projectRoot, 'tsconfig.json');
  if (existsSync(tsConfig)) {
    const text = readConfig(tsConfig);
    if (text !== undefined) {
      const parsed = ts.parseConfigFileTextToJson(tsConfig, text);
      if (!parsed.error) {
        const host: ts.ParseConfigHost = {
          useCaseSensitiveFileNames: true,
          readDirectory: () => [], // Source admission is supplied, never expanded by config globs.
          readFile: readConfig,
          fileExists: (path) => {
            if (!budgetCheck() || used.resolverProbes >= limits.maxResolverProbes) {
              diagnostics.push({ kind: 'budget', reason: 'max-config-resolver-probes' });
              incomplete = true;
              exhausted = true;
              return false;
            }
            used.resolverProbes++;
            const canonical = canonicalCandidate(path);
            if (canonical.excluded || isDependencyPath(projectRoot, canonical.path)) return false;
            try {
              return statSync(canonical.path).isFile();
            } catch {
              return false;
            }
          },
        };
        const config = ts.parseJsonConfigFileContent(parsed.config, host, dirname(tsConfig), undefined, tsConfig);
        configuredOptions = config.options;
        // Config discovery is deliberately excluded; supplied admission owns the source list.
        const errors = config.errors.filter((error) => error.code !== 18003);
        if (errors.length) {
          diagnostics.push({
            kind: 'config',
            reason: `compiler-options:${errors.map((error) => error.code).join(',')}`,
          });
          incomplete = true;
        }
      }
    }
  }
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...configuredOptions,
  };
  const configAliasPaths = compilerOptions.paths as Record<string, readonly string[]> | undefined;

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
    const roles = componentMatches.length > 0 ? ['definition'] : ['entrypoint'];
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
    compilerOptions,
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
    schemaVersion: 1 as const,
    projectRoot,
    files,
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
