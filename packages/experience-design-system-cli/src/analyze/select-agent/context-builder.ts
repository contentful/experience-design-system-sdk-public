import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RawComponentDefinition } from '../../types.js';

export type SelectionContextSummary = {
  boundaryRoot: string;
  siblingFileCount: number;
  resolverReferenceCount: number;
  hasParentUsageSite: boolean;
};

const SCANNED_FILE_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.ts', '.tsx', '.vue']);

const IMPORT_PATTERN = /import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/g;
const EXPORT_NAMED_PATTERN = /export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
const EXPORT_DEFAULT_PATTERN = /export\s+default\s+([A-Za-z0-9_]+)/g;
const EXPORT_LIST_PATTERN = /export\s*\{([^}]+)\}/g;
const RESOLVER_HINT_PATTERN = /(resolver|registry|componentmap|component-map|componentresolver|resolvecomponent)/i;

const MAX_COMPONENT_SOURCE_CHARS = 8_000;
const MAX_SIBLING_FILES = 5;
const MAX_SIBLING_SNIPPET_CHARS = 1_200;
const MAX_REFERENCE_SNIPPETS = 3;
const MAX_REFERENCE_CHARS = 800;

export type SelectionImportSummary = {
  source: string;
  names: string[];
  local: boolean;
  resolvedPath?: string;
};

export type SelectionFileSummary = {
  path: string;
  exports: string[];
  codeSnippet: string;
};

export type SelectionReference = {
  path: string;
  snippet: string;
};

export type SelectionContext = {
  boundaryRoot: string;
  componentFile: {
    path: string;
    code: string;
  };
  imports: SelectionImportSummary[];
  exports: string[];
  siblingFiles: SelectionFileSummary[];
  resolverReferences: SelectionReference[];
  parentUsageSite?: SelectionReference;
};

type IndexedFile = {
  absolutePath: string;
  relativePath: string;
  directory: string;
  text: string;
};

export type RepoContextIndex = {
  root: string;
  files: IndexedFile[];
  byDirectory: Map<string, IndexedFile[]>;
  filePaths: Set<string>;
};

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n/* truncated */';
}

function isWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function parseImportedNames(importClause: string): string[] {
  const names: string[] = [];
  const parts = importClause.split(',').map((part) => part.trim());

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const named of part
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const [local] = named.split(/\s+as\s+/i);
        if (local) names.push(local.trim());
      }
      continue;
    }

    const [local] = part.split(/\s+as\s+/i);
    if (local) names.push(local.trim());
  }

  return [...new Set(names)];
}

function resolveLocalImportPath(
  source: string,
  componentDirectory: string,
  root: string,
  filePaths: Set<string>,
): string | undefined {
  const basePath = resolve(componentDirectory, source);
  const candidates = [
    basePath,
    ...[...SCANNED_FILE_EXTENSIONS].map((extension) => `${basePath}${extension}`),
    ...[...SCANNED_FILE_EXTENSIONS].map((extension) => join(basePath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (filePaths.has(candidate) && isWithinRoot(candidate, root)) {
      return relative(root, candidate);
    }
  }

  if (isWithinRoot(basePath, root)) {
    return relative(root, basePath);
  }

  return undefined;
}

function parseImports(
  sourceText: string,
  componentDirectory: string,
  root: string,
  filePaths: Set<string>,
): SelectionImportSummary[] {
  const imports: SelectionImportSummary[] = [];

  for (const match of sourceText.matchAll(IMPORT_PATTERN)) {
    const importClause = match[1]?.trim() ?? '';
    const source = match[2]?.trim() ?? '';
    const local = source.startsWith('.');
    const names = parseImportedNames(importClause);
    const record: SelectionImportSummary = { source, names, local };
    if (local) {
      record.resolvedPath = resolveLocalImportPath(source, componentDirectory, root, filePaths);
    }
    imports.push(record);
  }

  return imports;
}

function parseExports(sourceText: string): string[] {
  const exports = new Set<string>();

  for (const match of sourceText.matchAll(EXPORT_NAMED_PATTERN)) {
    if (match[1]) exports.add(match[1]);
  }
  for (const match of sourceText.matchAll(EXPORT_DEFAULT_PATTERN)) {
    if (match[1]) exports.add(`default:${match[1]}`);
  }
  for (const match of sourceText.matchAll(EXPORT_LIST_PATTERN)) {
    const items =
      match[1]
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    for (const item of items) exports.add(item);
  }

  return [...exports];
}

function extractSnippet(text: string, token: string, maxChars: number): string {
  const index = text.indexOf(token);
  if (index === -1) return truncateText(text, maxChars);

  const start = Math.max(0, text.lastIndexOf('\n', Math.max(0, index - Math.floor(maxChars / 2))) + 1);
  const endBoundary = text.indexOf('\n', index + Math.floor(maxChars / 2));
  const end = endBoundary === -1 ? text.length : endBoundary;
  return truncateText(text.slice(start, end).trim(), maxChars);
}

function summarizeSiblingFiles(root: string, files: IndexedFile[], currentFile: string): SelectionFileSummary[] {
  return files
    .filter((file) => file.absolutePath !== currentFile)
    .slice(0, MAX_SIBLING_FILES)
    .map((file) => ({
      path: relative(root, file.absolutePath),
      exports: parseExports(file.text),
      codeSnippet: truncateText(file.text, MAX_SIBLING_SNIPPET_CHARS),
    }));
}

function findResolverReferences(
  root: string,
  files: IndexedFile[],
  componentName: string,
  currentFile: string,
): SelectionReference[] {
  return files
    .filter((file) => file.absolutePath !== currentFile)
    .filter((file) => file.text.includes(componentName))
    .filter((file) => RESOLVER_HINT_PATTERN.test(file.absolutePath) || RESOLVER_HINT_PATTERN.test(file.text))
    .slice(0, MAX_REFERENCE_SNIPPETS)
    .map((file) => ({
      path: relative(root, file.absolutePath),
      snippet: extractSnippet(file.text, componentName, MAX_REFERENCE_CHARS),
    }));
}

function findParentUsageSite(
  root: string,
  files: IndexedFile[],
  componentName: string,
  currentFile: string,
): SelectionReference | undefined {
  const usagePattern = new RegExp(`<${componentName}\\b|\\b${componentName}\\s*[),}]|\\b${componentName}\\s*:`);

  const candidates = files.filter(
    (file) =>
      file.absolutePath !== currentFile &&
      usagePattern.test(file.text) &&
      !file.text.startsWith('// stub') &&
      !RESOLVER_HINT_PATTERN.test(file.absolutePath) &&
      !RESOLVER_HINT_PATTERN.test(file.text),
  );
  const match = candidates[0];
  if (!match) return undefined;

  return {
    path: relative(root, match.absolutePath),
    snippet: extractSnippet(match.text, componentName, MAX_REFERENCE_CHARS),
  };
}

export async function buildRepoContextIndex(root: string, filePaths: string[]): Promise<RepoContextIndex | null> {
  if (filePaths.length === 0) return null;
  const resolvedRoot = resolve(root);

  const files = await Promise.all(
    filePaths.map(
      async (absolutePath): Promise<IndexedFile> => ({
        absolutePath,
        relativePath: relative(resolvedRoot, absolutePath),
        directory: dirname(absolutePath),
        text: await readFile(absolutePath, 'utf8').catch(() => ''),
      }),
    ),
  );

  const byDirectory = new Map<string, IndexedFile[]>();
  for (const file of files) {
    const bucket = byDirectory.get(file.directory) ?? [];
    bucket.push(file);
    byDirectory.set(file.directory, bucket);
  }

  return {
    root: resolvedRoot,
    files,
    byDirectory,
    filePaths: new Set(files.map((file) => file.absolutePath)),
  };
}

export function buildSelectionContext(
  index: RepoContextIndex,
  component: RawComponentDefinition,
): SelectionContext | undefined {
  const absolutePath = isAbsolute(component.source) ? component.source : resolve(index.root, component.source);
  if (!isWithinRoot(absolutePath, index.root)) return undefined;

  const componentFile = index.files.find((file) => file.absolutePath === absolutePath);
  if (!componentFile) return undefined;

  const siblings = index.byDirectory.get(componentFile.directory) ?? [];

  return {
    boundaryRoot: index.root,
    componentFile: {
      path: componentFile.relativePath,
      code: truncateText(componentFile.text, MAX_COMPONENT_SOURCE_CHARS),
    },
    imports: parseImports(componentFile.text, componentFile.directory, index.root, index.filePaths),
    exports: parseExports(componentFile.text),
    siblingFiles: summarizeSiblingFiles(index.root, siblings, componentFile.absolutePath),
    resolverReferences: findResolverReferences(index.root, index.files, component.name, componentFile.absolutePath),
    parentUsageSite: findParentUsageSite(index.root, index.files, component.name, componentFile.absolutePath),
  };
}

export function summarizeSelectionContext(context: SelectionContext | undefined): SelectionContextSummary | undefined {
  if (!context) return undefined;

  return {
    boundaryRoot: context.boundaryRoot,
    siblingFileCount: context.siblingFiles.length,
    resolverReferenceCount: context.resolverReferences.length,
    hasParentUsageSite: Boolean(context.parentUsageSite),
  };
}
