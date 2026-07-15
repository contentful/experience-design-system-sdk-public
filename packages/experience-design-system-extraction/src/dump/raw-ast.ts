import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { Node, type SourceFile } from 'ts-morph';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { parse as parseSvelte } from 'svelte/compiler';
import { createExtractionProject, loadTsMorphSourceFiles } from '../parse/project-factory.js';
import { sliceAstroSource } from '../extract/astro.js';

/**
 * Raw-AST dump: the literal parsed syntax tree for every file, with NO
 * component extraction, filtering, scoring, or de-duplication applied. This is
 * deliberately the opposite of `extractComponents` — it hands back everything
 * the parsers see, so downstream tooling can inspect the true source of truth.
 *
 * There is no single AST across the SDK: TS/JSX-family files parse with
 * ts-morph, `.vue` files with @vue/compiler-sfc, and `.svelte` files with the
 * Svelte compiler. Each dumped file therefore carries a `parser` tag and its
 * tree in that parser's NATIVE shape (ts-morph nodes are converted to plain,
 * acyclic JSON; Vue/Svelte trees are already plain objects).
 */
export type AstParser = 'ts-morph' | 'vue-sfc' | 'svelte' | 'astro';

/** A ts-morph node reduced to structure + text, with parent links dropped so it is JSON-serialisable. */
export interface TsMorphAstNode {
  /** SyntaxKind name, e.g. "FunctionDeclaration". */
  kind: string;
  /** Numeric SyntaxKind, for consumers that prefer the enum value. */
  kindValue: number;
  /** Full source text of this node (structural+text fidelity). */
  text: string;
  /** Character offset of the node start (including leading trivia excluded). */
  pos: number;
  /** Character offset of the node end. */
  end: number;
  /** 1-indexed start line. */
  startLine: number;
  /** 1-indexed end line. */
  endLine: number;
  children: TsMorphAstNode[];
}

export interface RawAstFile {
  /** Absolute path to the file. */
  filePath: string;
  parser: AstParser;
  /** The native tree. Shape depends on `parser`. Null when the file failed to parse. */
  ast: TsMorphAstNode | unknown | null;
  /** Non-fatal messages (parse errors, unreadable file, etc.). */
  warnings: string[];
}

export interface RawAstDump {
  files: RawAstFile[];
  warnings: string[];
}

const TS_MORPH_EXTENSION = /\.[cm]?[jt]sx?$/;
const DUMP_CONCURRENCY = Number(process.env['EDS_EXTRACT_CONCURRENCY'] ?? 0) || os.cpus().length;

/**
 * Convert a ts-morph node into a plain, acyclic object. ts-morph/TS nodes carry
 * parent back-references and live compiler state, so they cannot be
 * `JSON.stringify`'d directly — we project each node to structure + text and
 * recurse over children only.
 */
function serializeTsMorphNode(node: Node): TsMorphAstNode {
  return {
    kind: node.getKindName(),
    kindValue: node.getKind(),
    text: node.getText(),
    pos: node.getStart(),
    end: node.getEnd(),
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    children: node.getChildren().map(serializeTsMorphNode),
  };
}

function dumpTsMorphFiles(filePaths: string[]): RawAstFile[] {
  if (filePaths.length === 0) return [];

  // Mirror the whole-file extractors' parse setup, but with both JSX and JS
  // always enabled so a single project can hold every TS-family file regardless
  // of which extractor would normally claim it.
  const { sourceFiles } = loadTsMorphSourceFiles(filePaths, { jsx: true, allowJs: true });
  const byPath = new Map<string, SourceFile>();
  for (const sourceFile of sourceFiles) {
    byPath.set(sourceFile.getFilePath(), sourceFile);
  }

  return filePaths.map((filePath) => {
    const sourceFile = byPath.get(filePath) ?? sourceFiles.find((sf) => sf.getFilePath().endsWith(filePath));
    if (!sourceFile) {
      return {
        filePath,
        parser: 'ts-morph',
        ast: null,
        warnings: [`Failed to load ${filePath} into ts-morph project`],
      };
    }
    try {
      return { filePath, parser: 'ts-morph', ast: serializeTsMorphNode(sourceFile), warnings: [] };
    } catch (e) {
      return {
        filePath,
        parser: 'ts-morph',
        ast: null,
        warnings: [`Failed to serialize ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  });
}

async function dumpVueFile(filePath: string): Promise<RawAstFile> {
  try {
    const source = await readFile(filePath, 'utf-8');
    const { descriptor, errors } = parseSFC(source);
    const warnings = errors.map((e) => `Parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    return { filePath, parser: 'vue-sfc', ast: descriptor, warnings };
  } catch (e) {
    return {
      filePath,
      parser: 'vue-sfc',
      ast: null,
      warnings: [`Failed to read/parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

/**
 * `.astro` files have no single-parser tree. We reproduce what the astro
 * extractor sees: the frontmatter fence parsed as a ts-morph SourceFile, plus
 * the raw template string. The result is an envelope, not a homogeneous
 * ts-morph node, so it is tagged `astro`.
 */
async function dumpAstroFile(filePath: string): Promise<RawAstFile> {
  try {
    const source = await readFile(filePath, 'utf-8');
    const { frontmatter, template } = sliceAstroSource(source);

    let frontmatterAst: TsMorphAstNode | null = null;
    const warnings: string[] = [];
    if (frontmatter.trim()) {
      const project = createExtractionProject({ jsx: true, allowJs: true });
      const sf = project.createSourceFile('__frontmatter__.ts', frontmatter);
      frontmatterAst = serializeTsMorphNode(sf);
    }

    return {
      filePath,
      parser: 'astro',
      ast: { frontmatter: frontmatterAst, template },
      warnings,
    };
  } catch (e) {
    return {
      filePath,
      parser: 'astro',
      ast: null,
      warnings: [`Failed to read/parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

async function dumpSvelteFile(filePath: string): Promise<RawAstFile> {
  try {
    const source = await readFile(filePath, 'utf-8');
    const ast = parseSvelte(source, { modern: true });
    return { filePath, parser: 'svelte', ast, warnings: [] };
  } catch (e) {
    return {
      filePath,
      parser: 'svelte',
      ast: null,
      warnings: [`Failed to read/parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

function isTsMorphFile(filePath: string): boolean {
  return TS_MORPH_EXTENSION.test(filePath);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Dump the raw, unfiltered AST for every given file. Files are routed to their
 * native parser by extension:
 *   - `.ts/.tsx/.js/.jsx/.cjs/.mjs/...` → ts-morph SourceFile tree
 *   - `.vue` → @vue/compiler-sfc descriptor
 *   - `.svelte` → svelte/compiler AST
 *   - `.astro` → frontmatter parsed as ts-morph + raw template string
 *
 * Callers are responsible for the file list (e.g. via the CLI's
 * `collectSourceFiles`). Pass literally every parseable file for a full-codebase
 * dump — this function applies no exclusions of its own beyond routing.
 */
export async function dumpRawAst(filePaths: string[]): Promise<RawAstDump> {
  const tsMorphFiles = filePaths.filter(isTsMorphFile);
  const vueFiles = filePaths.filter((f) => f.endsWith('.vue'));
  const svelteFiles = filePaths.filter((f) => f.endsWith('.svelte'));
  const astroFiles = filePaths.filter((f) => f.endsWith('.astro'));
  const routed = new Set([...tsMorphFiles, ...vueFiles, ...svelteFiles, ...astroFiles]);
  const unsupportedFiles = filePaths.filter((f) => !routed.has(f));

  const warnings: string[] = [];
  const files: RawAstFile[] = [];

  // ts-morph files are parsed synchronously into one shared project.
  files.push(...dumpTsMorphFiles(tsMorphFiles));

  const vueResults = await mapWithConcurrency(vueFiles, DUMP_CONCURRENCY, dumpVueFile);
  files.push(...vueResults);

  const svelteResults = await mapWithConcurrency(svelteFiles, DUMP_CONCURRENCY, dumpSvelteFile);
  files.push(...svelteResults);

  const astroResults = await mapWithConcurrency(astroFiles, DUMP_CONCURRENCY, dumpAstroFile);
  files.push(...astroResults);

  for (const filePath of unsupportedFiles) {
    warnings.push(`No AST parser for ${filePath} (unsupported extension); skipped`);
  }

  // Stable ordering: sort by path so the dump is deterministic across runs.
  files.sort((a, b) => a.filePath.localeCompare(b.filePath));

  return { files, warnings };
}
