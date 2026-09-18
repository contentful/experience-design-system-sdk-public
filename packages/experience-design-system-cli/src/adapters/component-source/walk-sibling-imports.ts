import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { excerptAroundNames } from '../../session/source-excerpt.js';
import {
  MAX_ENLARGED_SIBLINGS,
  MAX_SIBLING_CANDIDATES_EXPLORED,
  MAX_SIBLING_DEPTH,
  MAX_SIBLING_FILES,
  MAX_SIBLING_SNIPPET_CHARS,
  MAX_TYPE_DECLARING_SIBLING_CHARS,
  SIBLING_FILE_EXTENSIONS,
} from './constants.js';
import { declaresAnyType, extractRelativeImportPaths, rewrittenSourcePaths } from './extract-relative-imports.js';

// Tries the specifier as a file directly, then with each known extension,
// then as a directory's index file — same resolution order as Node's own
// extension-less relative import resolution.
async function resolveRelativeImport(specifier: string, fromDir: string): Promise<string | undefined> {
  const basePath = resolve(fromDir, specifier);
  const candidates = [
    basePath,
    ...rewrittenSourcePaths(basePath),
    ...SIBLING_FILE_EXTENSIONS.map((ext) => `${basePath}${ext}`),
    ...SIBLING_FILE_EXTENSIONS.map((ext) => resolve(basePath, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      // Not this candidate — try the next.
    }
  }
  return undefined;
}

// Resolves every relative specifier a file imports, in source order. Bare
// package specifiers (`react`, `@scope/pkg`) are deliberately not followed:
// on a monorepo they resolve to built `dist/` bundles, which fill sibling
// slots with minified output rather than the source line a classifier can
// cite.
async function resolveImportSpecifiers(sourceText: string, fromDir: string): Promise<string[]> {
  const resolvedPaths: string[] = [];
  for (const specifier of extractRelativeImportPaths(sourceText)) {
    const resolvedPath = await resolveRelativeImport(specifier, fromDir);
    if (resolvedPath) resolvedPaths.push(resolvedPath);
  }
  return resolvedPaths;
}

// Loads the content of files the component's source file relatively imports
// — either directly (e.g. a co-located `.styles.ts`), or transitively through
// a sibling that is itself imported (bounded by MAX_SIBLING_DEPTH). Token
// resolution logic (e.g. a variant-to-token map)
// sometimes lives behind a component that re-exports another component's
// prop rather than beside the component being classified, so a single hop
// of resolution can miss it. Breadth-first with a visited-set: a component
// that imports another which imports it back (or any other cycle) is
// walked exactly once. Returns the count of resolved candidates dropped
// once the inlining cap was hit, so callers can surface that truncation to
// the classifier instead of silently dropping evidence.
export async function loadSiblingFiles(
  sourceText: string,
  sourcePath: string,
  propNames: string[],
  candidateTypeNames: string[] = [],
): Promise<{
  siblings: Array<{ path: string; content: string }>;
  truncatedCount: number;
  /** Prop names with at least one use that fell outside a sibling's excerpt budget. */
  usesNotShown: string[];
  /** The candidate type names that the component's own source or a discovered sibling declares. */
  declaredTypeNames: string[];
}> {
  const visited = new Set<string>([resolve(sourcePath)]);
  const discovered: Array<{ path: string; content: string }> = [];

  let frontier: Array<{ text: string; dir: string }> = [{ text: sourceText, dir: dirname(sourcePath) }];

  for (let hop = 0; hop < MAX_SIBLING_DEPTH && discovered.length < MAX_SIBLING_CANDIDATES_EXPLORED; hop++) {
    const nextFrontier: Array<{ text: string; dir: string }> = [];

    for (const node of frontier) {
      if (discovered.length >= MAX_SIBLING_CANDIDATES_EXPLORED) break;

      const resolvedPaths = await resolveImportSpecifiers(node.text, node.dir);
      for (const resolvedPath of resolvedPaths) {
        if (visited.has(resolvedPath)) continue;
        visited.add(resolvedPath);
        if (discovered.length >= MAX_SIBLING_CANDIDATES_EXPLORED) break;

        let content: string;
        try {
          content = await readFile(resolvedPath, 'utf8');
        } catch {
          // Resolved but became unreadable between the resolve check and this read — skip it.
          continue;
        }
        discovered.push({ path: resolvedPath, content });
        nextFrontier.push({ text: content, dir: dirname(resolvedPath) });
      }
    }

    frontier = nextFrontier;
  }

  // Only the type names some file in hand declares are worth windowing on;
  // the rest have no declaration to find (see IDENTIFIER_PATTERN above).
  const inHand = [sourceText, ...discovered.map((d) => d.content)];
  const declaredTypeNames = candidateTypeNames.filter((name) => inHand.some((text) => declaresAnyType(text, [name])));

  // Excerpts are windowed around the prop names rather than cut from the
  // head: a styles module's first lines are imports, and the line that decides
  // a prop's classification is wherever that prop is interpolated.
  const usesNotShown = new Set<string>();
  const searchNames = [...new Set([...propNames, ...declaredTypeNames])];
  let enlarged = 0;
  const siblings = discovered.slice(0, MAX_SIBLING_FILES).map((d) => {
    const enlarge = enlarged < MAX_ENLARGED_SIBLINGS && declaresAnyType(d.content, declaredTypeNames);
    if (enlarge) enlarged++;
    const budget = enlarge ? MAX_TYPE_DECLARING_SIBLING_CHARS : MAX_SIBLING_SNIPPET_CHARS;
    const excerpt = excerptAroundNames(d.content, searchNames, budget);
    for (const name of excerpt.usesNotShown) usesNotShown.add(name);
    return { path: d.path, content: excerpt.content };
  });
  const truncatedCount = Math.max(0, discovered.length - MAX_SIBLING_FILES);

  return {
    siblings,
    truncatedCount,
    usesNotShown: propNames.filter((name) => usesNotShown.has(name)),
    declaredTypeNames,
  };
}
