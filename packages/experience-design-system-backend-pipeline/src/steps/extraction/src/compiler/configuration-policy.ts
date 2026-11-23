import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { jsonEqual } from '@contentful/experience-design-system-types';
import type { CompilerProjectDiagnostic, CompilerReferenceDiagnostic } from '../candidates/types.js';

const DEFAULT_REFERENCE_LIMITS = { maxReferenceDepth: 8, maxReferences: 64 };

export interface CompilerConfigurationReader {
  readFile: (path: string) => string | undefined;
  canonicalizeConfigPath?: (path: string) => string;
  host: ts.ParseConfigHost;
  used: { references: number };
  maxReferences?: number;
  consumeReferences?: (count: number) => boolean;
  explicitInputsOnly?: boolean;
  admittedRelativeExtendsOnly?: boolean;
  shouldContinue?: () => boolean;
  referencePaths?: Set<string>;
  parsedConfigs?: Map<string, { config: ParsedConfig; readPaths: string[] }>;
}

export interface ParsedConfig {
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

export function isAdmittedCompilerConfig(
  projectRoot: string,
  requestedPath: string,
  canonicalPath: string,
  allowPackageMetadata = false,
): boolean {
  const dependency = (path: string) => path.split(sep).some((part) => part === 'node_modules' || part === '.pnpm');
  if (dependency(requestedPath) || dependency(canonicalPath)) return allowPackageMetadata;
  return isWithin(projectRoot, canonicalPath) || resolve(requestedPath) === canonicalPath;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function configNames(directory: string, fileExists: (path: string) => boolean): string[] {
  const tsConfig = resolve(directory, 'tsconfig.json');
  const jsConfig = resolve(directory, 'jsconfig.json');
  const found = [tsConfig, jsConfig].filter((path) => fileExists(path));
  return found;
}

function findNearestConfig(
  filePath: string,
  projectRoot: string,
  maxReads: number,
  fileExists: (path: string) => boolean,
  shouldContinue?: () => boolean,
): { path: string | null; ambiguous: boolean; exhausted?: boolean } {
  let current = dirname(resolve(filePath));
  if (!isWithin(projectRoot, current)) return { path: null, ambiguous: false };
  let reads = 0;
  while (reads < maxReads) {
    if (shouldContinue?.() === false) return { path: null, ambiguous: false, exhausted: true };
    const found = configNames(current, fileExists);
    if (found.length > 0)
      return { path: found.find((path) => path.endsWith('tsconfig.json')) ?? found[0]!, ambiguous: found.length > 1 };
    const parent = dirname(current);
    if (parent === current) return { path: null, ambiguous: false };
    current = parent;
    reads += 1;
  }
  return { path: null, ambiguous: false, exhausted: true };
}

function referencePath(reference: ts.ProjectReference): string {
  const path = resolve(reference.path);
  return path.endsWith('.json') ? path : resolve(path, 'tsconfig.json');
}

function parseConfig(path: string, reader: CompilerConfigurationReader): ParsedConfig {
  const requestedPath = path;
  path = reader.canonicalizeConfigPath?.(path) ?? path;
  const cache: NonNullable<CompilerConfigurationReader['parsedConfigs']> = (reader.parsedConfigs ??= new Map());
  const previous = cache.get(path);
  if (previous) {
    previous.readPaths.forEach((dependency) => reader.readFile(dependency));
    return previous.config;
  }
  const readPaths = new Set<string>();
  const readFile = (dependency: string) => {
    readPaths.add(dependency);
    return reader.readFile(dependency);
  };
  const text = readFile(requestedPath);
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
  const admissionDiagnostics: string[] = [];
  const admittedConfig = (config: Record<string, unknown>): boolean => {
    const extended = config.extends;
    const values = typeof extended === 'string' ? [extended] : Array.isArray(extended) ? extended : [];
    let admitted = true;
    for (const value of values)
      if (
        reader.admittedRelativeExtendsOnly &&
        typeof value === 'string' &&
        !value.startsWith('.') &&
        !isAbsolute(value)
      ) {
        admissionDiagnostics.push(`unsupported-package-config-extends:${value}`);
        admitted = false;
      }
    return admitted;
  };
  const host: ts.ParseConfigHost = {
    ...reader.host,
    readFile: (extendedPath) => {
      const extendedText = readFile(extendedPath);
      if (extendedText === undefined) return undefined;
      const extendedJson = ts.parseConfigFileTextToJson(extendedPath, extendedText);
      return extendedJson.config && !admittedConfig(extendedJson.config) ? undefined : extendedText;
    },
  };
  const admitted = admittedConfig(json.config);
  const parsed = ts.parseJsonConfigFileContent(
    admitted ? json.config : { ...json.config, extends: undefined },
    host,
    dirname(path),
    { noEmit: true },
    path,
    undefined,
    ['.vue', '.svelte', '.astro'].map((extension) => ({
      extension,
      isMixedContent: true,
      scriptKind: ts.ScriptKind.Deferred,
    })),
  );
  const diagnostics = [
    ...parsed.errors.filter((error) => !reader.explicitInputsOnly || error.code !== 18003).map(formatDiagnostic),
    ...admissionDiagnostics,
  ];
  const result: ParsedConfig = {
    path,
    text,
    status: diagnostics.length > 0 ? 'invalid' : 'configured',
    diagnostics,
    parsed,
  };
  cache.set(path, { config: result, readPaths: [...readPaths] });
  return result;
}

function analysisOptions(config: ParsedConfig): ts.CompilerOptions {
  const { configFilePath: _configFilePath, rootDir: _rootDir, ...options } = config.parsed.options;
  return options;
}

interface ReferencedConfigSelection {
  config: ParsedConfig;
  outcome: CompilerReferenceDiagnostic['outcome'];
  details: string[];
  matches: boolean;
}

function selectReferencedConfig(
  config: ParsedConfig,
  filePath: string,
  reader: CompilerConfigurationReader,
  visited = new Set<string>(),
  depth = 0,
  maxDepth = DEFAULT_REFERENCE_LIMITS.maxReferenceDepth,
): ReferencedConfigSelection {
  if (depth >= maxDepth)
    return {
      config,
      outcome: 'budget-exhausted',
      details: ['project-reference-depth-budget-exhausted'],
      matches: true,
    };
  if (visited.has(config.path))
    return { config, outcome: 'cycle', details: ['project-reference-cycle'], matches: true };
  visited.add(config.path);
  const references = config.parsed.projectReferences ?? [];
  const referencePaths = (reader.referencePaths ??= new Set());
  const newReferences = [...new Set(references.map(referencePath))].filter((path) => !referencePaths.has(path));
  reader.used.references += newReferences.length;
  if (
    reader.used.references > (reader.maxReferences ?? DEFAULT_REFERENCE_LIMITS.maxReferences) ||
    reader.consumeReferences?.(newReferences.length) === false
  )
    return {
      config,
      outcome: 'budget-exhausted',
      details: ['project-reference-count-budget-exhausted'],
      matches: true,
    };
  newReferences.forEach((path) => referencePaths.add(path));
  if (references.length === 0) {
    return {
      config,
      outcome: config.status === 'configured' ? 'selected' : 'invalid',
      details: config.diagnostics,
      matches:
        depth === 0 ||
        config.parsed.fileNames.some((path) => (reader.canonicalizeConfigPath?.(path) ?? resolve(path)) === filePath),
    };
  }
  const matching = references
    .map((reference): ReferencedConfigSelection => {
      const referenced = parseConfig(referencePath(reference), reader);
      if (referenced.status === 'invalid')
        return {
          config: referenced,
          outcome: 'invalid',
          details: referenced.diagnostics,
          matches: isWithin(dirname(referenced.path), filePath),
        };
      return selectReferencedConfig(referenced, filePath, reader, new Set(visited), depth + 1, maxDepth);
    })
    .filter((selection) => selection.matches);
  if (matching.length > 1) {
    const equivalent = matching.every(
      (selection) =>
        selection.outcome === 'selected' &&
        jsonEqual(analysisOptions(selection.config), analysisOptions(matching[0]!.config)),
    );
    if (equivalent)
      return {
        ...matching.sort((a, b) => a.config.path.localeCompare(b.config.path))[0]!,
        details: [
          ...new Set([...matching.flatMap((selection) => selection.details), 'analysis-equivalent-project-references']),
        ],
      };
    return { config, outcome: 'ambiguous', details: ['root-matches-overlapping-project-references'], matches: true };
  }
  if (matching.length === 0)
    return {
      config,
      outcome: 'ambiguous',
      details: ['root-not-covered-by-project-references', ...config.diagnostics],
      matches: false,
    };
  return matching[0]!;
}

export function selectCompilerConfiguration(
  filePath: string,
  projectRoot: string,
  reader: CompilerConfigurationReader,
  fileExists: (path: string) => boolean,
  maxNearestDirectories: number,
): {
  config: ParsedConfig | null;
  status: CompilerProjectDiagnostic['status'];
  referenceOutcome: CompilerReferenceDiagnostic['outcome'];
  diagnostics: string[];
} {
  const nearest = findNearestConfig(filePath, projectRoot, maxNearestDirectories, fileExists, reader.shouldContinue);
  if (!nearest.path)
    return {
      config: null,
      status: nearest.exhausted ? 'invalid' : 'fallback',
      referenceOutcome: nearest.exhausted ? 'budget-exhausted' : 'fallback',
      diagnostics: [nearest.exhausted ? 'config-ancestor-search-budget-exhausted' : 'config-not-found'],
    };
  const base = parseConfig(nearest.path, reader);
  const selected = selectReferencedConfig(base, filePath, reader);
  const status =
    nearest.ambiguous || selected.outcome === 'ambiguous'
      ? 'ambiguous'
      : selected.outcome === 'invalid' || base.status === 'invalid'
        ? 'invalid'
        : 'configured';
  return {
    config: selected.config,
    status,
    referenceOutcome: selected.outcome,
    diagnostics: [...(nearest.ambiguous ? ['multiple-config-files-at-same-root'] : []), ...selected.details],
  };
}
