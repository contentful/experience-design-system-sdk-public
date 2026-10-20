import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
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
): { path: string | null; ambiguous: boolean } {
  let current = dirname(resolve(filePath));
  let reads = 0;
  while (isWithin(projectRoot, current) && reads < maxReads) {
    const found = configNames(current, fileExists);
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

function parseConfig(path: string, reader: CompilerConfigurationReader): ParsedConfig {
  path = reader.canonicalizeConfigPath?.(path) ?? path;
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
      const extendedText = reader.readFile(extendedPath);
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
  );
  const diagnostics = [
    ...parsed.errors.filter((error) => !reader.explicitInputsOnly || error.code !== 18003).map(formatDiagnostic),
    ...admissionDiagnostics,
  ];
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
  reader: CompilerConfigurationReader,
  visited = new Set<string>(),
  depth = 0,
  maxDepth = DEFAULT_REFERENCE_LIMITS.maxReferenceDepth,
): { config: ParsedConfig; outcome: CompilerReferenceDiagnostic['outcome']; details: string[] } {
  if (depth >= maxDepth)
    return { config, outcome: 'budget-exhausted', details: ['project-reference-depth-budget-exhausted'] };
  if (visited.has(config.path)) return { config, outcome: 'cycle', details: ['project-reference-cycle'] };
  visited.add(config.path);
  const references = config.parsed.projectReferences ?? [];
  reader.used.references += references.length;
  if (
    reader.used.references > (reader.maxReferences ?? DEFAULT_REFERENCE_LIMITS.maxReferences) ||
    reader.consumeReferences?.(references.length) === false
  )
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

/** Select configuration without constructing a project or discovering source files. */
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
  const nearest = findNearestConfig(filePath, projectRoot, maxNearestDirectories, fileExists);
  if (!nearest.path)
    return { config: null, status: 'fallback', referenceOutcome: 'fallback', diagnostics: ['config-not-found'] };
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
