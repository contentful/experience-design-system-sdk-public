import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  extractComponents,
  evaluateExtractionQuality,
  preClassifyComponent,
  preClassifyProp,
} from '@contentful/experience-design-system-extraction';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  updateStep,
  storeRawComponents,
  storeScannedFiles,
  storeSlotCycles,
} from '../session/db.js';
import { findSlotCycles, suggestCycleBreakEdge } from './cycle-detection.js';
import { resolveMapping } from './composition/resolve-mapping.js';
import { collectManifestDocEdges } from './composition/manifest-doc-evidence.js';
import {
  collectSourceCallSiteEvidence,
  type SourceCallSiteEvidence,
  type SourceCallSiteRejection,
} from './composition/source-call-site-evidence.js';
import {
  bindAnalyticsSessionId,
  emitSessionStarted,
  enrichCommandResult,
  exitWithAnalytics,
  isPipelineAnalyticsChild,
} from '../analytics/index.js';
import { getDebugLogger } from '../lib/debug-logger.js';

interface AnalyzeExtractOptions {
  project: string;
  dir?: string;
  resolveUnreachable?: 'auto' | 'always' | 'never';
}

const SCANNED_FILE_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);
/**
 * `.json`/`.md` are scanned too (Figma `manifest.json`, `AGENTS.md`-style
 * docs, and other design/composition-adjacent files we don't yet have a name
 * for) — gated by a denylist rather than an allowlist, so coverage isn't
 * capped at a couple of exact filenames. Their content is never inlined into
 * an LLM prompt by virtue of being scanned here. Deterministic parsing
 * (manifest-doc-evidence.ts) reads this full set directly, with no LLM
 * involved, which is the actual prompt-injection safeguard for that signal.
 */
const DENYLIST_GATED_EXTENSIONS = new Set(['.json', '.md']);
const DENYLISTED_EXACT_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'nx.json',
  'project.json',
  'turbo.json',
  'lerna.json',
  'jsconfig.json',
]);
/** Config-file families that vary by suffix (`tsconfig.build.json`, `.eslintrc.cjs.json`, ...) plus common repo docs. */
const DENYLISTED_FILE_NAME_PATTERNS = [
  /^tsconfig(\..+)?\.json$/,
  /^\.?eslintrc(\..+)?\.json$/,
  /^\.?prettierrc(\..+)?\.json$/,
  /^(readme|changelog|contributing|code_of_conduct|license|security)(\..+)?\.md$/i,
];
function isDenylistedNoiseFile(name: string): boolean {
  return DENYLISTED_EXACT_FILE_NAMES.has(name) || DENYLISTED_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}
const IGNORED_DIRECTORY_NAMES = new Set([
  '.changeset',
  '.git',
  '.github',
  '.idea',
  '.next',
  '.nuxt',
  '.vscode',
  'build',
  'coverage',
  'demo',
  'demos',
  'dist',
  'example',
  'examples',
  'node_modules',
  'out',
  'storybook-static',
]);
const IGNORED_FILE_SUFFIXES = new Set([
  '.stories.ts',
  '.stories.tsx',
  '.stories.js',
  '.stories.jsx',
  '.story.ts',
  '.story.tsx',
  '.story.js',
  '.story.jsx',
  '.spec.ts',
  '.spec.tsx',
  '.test.ts',
  '.test.tsx',
]);

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function retryDatabaseWrite<T>(operation: () => T, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|database is busy/i.test(message) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2000)));
    }
  }
}

function resolveFromProjectRoot(projectRoot: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(projectRoot, inputPath);
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null));
}

export async function collectSourceFiles(
  directory: string,
  onProgress?: (scannedCount: number) => void,
): Promise<string[]> {
  const files: string[] = [];

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    const subdirs: string[] = [];

    for (const entry of entries) {
      const fullPath = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          subdirs.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      const isCodeFile = SCANNED_FILE_EXTENSIONS.has(extension) && !entry.name.endsWith('.d.ts');
      const isNoiseGatedFile = DENYLIST_GATED_EXTENSIONS.has(extension) && !isDenylistedNoiseFile(entry.name);
      if (!isCodeFile && !isNoiseGatedFile) {
        continue;
      }

      if ([...IGNORED_FILE_SUFFIXES].some((suffix) => entry.name.endsWith(suffix))) {
        continue;
      }

      files.push(fullPath);
      onProgress?.(files.length);
    }

    await Promise.all(subdirs.map((subdir) => visit(subdir)));
  }

  await visit(directory);
  return files.sort();
}

/** Read the persisted default composition mode; missing config is fine. */
/**
 * Read the source files of the extracted components plus nearby mapping/meta
 * files, so the candidate pre-filter (T3) can pick the relevant ones. Reads
 * each unique `sourcePath` once; missing files are skipped.
 */
async function readCandidateFiles(
  components: Array<{ sourcePath?: string; source?: string }>,
  extraFiles: string[] = [],
): Promise<Array<{ path: string; content: string }>> {
  const paths = new Set<string>(extraFiles);
  for (const c of components) {
    if (c.sourcePath) paths.add(c.sourcePath);
  }
  const out: Array<{ path: string; content: string }> = [];
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        const content = await readFile(p, 'utf8');
        out.push({ path: p, content });
      } catch {
        void 0;
      }
    }),
  );
  return out;
}

export function registerInternalExtractCommand(program: Command): void {
  program
    .command('__extract', { hidden: true })
    .description('Extract component definitions from a project')
    .requiredOption('--project <path>', 'Path to the project root')
    .option('--dir <path>', 'Path to the component source directory relative to the project root')
    .option(
      '--resolve-unreachable <mode>',
      "Retry pass for unresolved Svelte Props types: 'auto' (default), 'always', or 'never'",
      'auto',
    )
    .action(async (opts: AnalyzeExtractOptions) => {
      const resolveUnreachable: 'auto' | 'always' | 'never' = (() => {
        const v = opts.resolveUnreachable ?? 'auto';
        if (v !== 'auto' && v !== 'always' && v !== 'never') {
          process.stderr.write(`Error: --resolve-unreachable must be one of 'auto', 'always', 'never' (got '${v}')\n`);
          process.exit(1);
        }
        return v;
      })();
      const projectRoot = resolve(opts.project);
      const outDir = join(projectRoot, '.contentful');

      let sourceDirectory: string;
      if (opts.dir !== undefined) {
        sourceDirectory = resolveFromProjectRoot(projectRoot, opts.dir);
        if (!(await pathExists(sourceDirectory))) {
          process.stderr.write(`Error: source directory does not exist: ${sourceDirectory}\n`);
          process.exit(1);
        }
      } else {
        const srcPath = resolveFromProjectRoot(projectRoot, 'src');
        sourceDirectory = (await pathExists(srcPath)) ? srcPath : projectRoot;
      }

      const sourceFiles = await collectSourceFiles(sourceDirectory, (count) => {
        if (!process.stdout.isTTY) {
          process.stderr.write(`progress=scan:${count}\n`);
        }
      });
      if (!process.stdout.isTTY) {
        process.stderr.write(`progress=scan-done:${sourceFiles.length}\n`);
      }

      const extraction = await extractComponents(
        sourceFiles,
        ({ filesProcessed, componentsFound }) => {
          if (!process.stdout.isTTY) {
            process.stderr.write(`progress=extract:${filesProcessed}/${sourceFiles.length}:${componentsFound}\n`);
          }
        },
        { resolveUnreachable, projectRoot },
      );

      await mkdir(outDir, { recursive: true });

      const db = openPipelineDb();
      const { sessionId } = getOrCreateSession(db, undefined, undefined, {
        command: 'analyze extract',
        inputPath: projectRoot,
        outDir,
      });
      await bindAnalyticsSessionId(sessionId);
      if (!isPipelineAnalyticsChild()) {
        await emitSessionStarted('analyze_extract');
      }
      const stepId = createStep(db, sessionId, 'analyze extract', {
        project: projectRoot,
      });
      const classifiedComponents = extraction.components.map(preClassifyComponent);
      for (const exclusion of extraction.exclusions ?? []) {
        getDebugLogger().event('filter', 'extract.excluded', { ...exclusion });
      }
      for (const component of extraction.components) {
        for (const prop of component.props) {
          if (preClassifyProp(prop)?.category === 'exclude') {
            getDebugLogger().event('filter', 'extract.excluded', {
              itemType: 'prop',
              name: prop.name,
              source: component.source,
              component: component.name,
              reason: 'deterministic pre-classification excluded this wiring prop',
              stage: 'pre-classify',
            });
          }
        }
      }
      const { components: initialValidatedComponents, warnings: filterWarnings } =
        await evaluateExtractionQuality(classifiedComponents);
      let validatedComponents = initialValidatedComponents;

      // Persist the extraction result before composition mapping so downstream
      // stages can start working while the (potentially agent-backed) mapper
      // continues. The final write below replaces these definitions with the
      // composition-enriched version while preserving selection decisions.
      storeRawComponents(db, sessionId, validatedComponents);
      process.stdout.write(`session=${sessionId}\n`);

      let sourceCallSiteEvidence: SourceCallSiteEvidence[] = [];
      let sourceCallSiteRejections: SourceCallSiteRejection[] = [];

      // Composition mapping resolution is always enabled. Every extracted CDF
      // preserves embedded-component edges.
      {
        {
          // Composition resolution runs unconditionally so structural evidence
          // (typed slots + Signal A/B/C/D), cited call sites and manifest/doc
          // edges always reach the selection UI. No agent contributes edges.
          //
          // Composition progress mirrors the scan/extract progress convention:
          // emit `progress=composition:<phase>` on stderr so the wizard can
          // render a second progress line during resolution.
          const emitCompositionProgress = (phase: string): void => {
            if (!process.stdout.isTTY) process.stderr.write(`progress=composition:${phase}\n`);
          };

          emitCompositionProgress('resolving');
          const allFiles = await readCandidateFiles(validatedComponents, sourceFiles);
          const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));

          const componentNameSet = new Set(validatedComponents.map((c) => c.name));

          // Manifest (Figma `manifest.json`)/doc (`AGENTS.md`) evidence — rank
          // 4/5, deterministic (no LLM), runs over the FULL file set
          // since it's cheap and code/design-adjacent.
          const manifestDocEdges = collectManifestDocEdges(runtimeFiles, validatedComponents, componentNameSet);
          const extraEdges = manifestDocEdges;
          const sourceCallSites = collectSourceCallSiteEvidence(runtimeFiles, validatedComponents);
          sourceCallSiteEvidence = sourceCallSites.accepted;
          sourceCallSiteRejections = sourceCallSites.rejected;

          const result = resolveMapping({
            components: validatedComponents,
            ...(extraEdges.length > 0 ? { extraEdges } : {}),
            sourceCallSiteEvidence,
            sourceCallSiteRejections,
          });
          emitCompositionProgress('done');

          for (const w of result.warnings) process.stderr.write(`Warning: composition — ${w}\n`);
          for (const c of result.conflicts) {
            process.stderr.write(
              `Warning: composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}\n`,
            );
          }

          validatedComponents = result.components as typeof validatedComponents;
        }
      }

      await retryDatabaseWrite(() => storeRawComponents(db, sessionId, validatedComponents, { preserveStatus: true }));

      const cycleInput = validatedComponents.map((c) => ({
        name: c.name,
        slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
      }));
      const cycles = findSlotCycles(cycleInput);
      const withBreaks = cycles.map((cycle) => ({
        ...cycle,
        suggestedBreak: suggestCycleBreakEdge(cycle, cycles),
      }));
      await retryDatabaseWrite(() => storeSlotCycles(db, sessionId, withBreaks));

      storeScannedFiles(
        db,
        sessionId,
        sourceFiles.map((f) => relative(projectRoot, f)),
      );
      await retryDatabaseWrite(() =>
        updateStep(db, stepId, 'complete', {
          sessionId,
          compositionEvidence: JSON.stringify(sourceCallSiteEvidence),
          compositionRejections: JSON.stringify(sourceCallSiteRejections),
        }),
      );
      enrichCommandResult({ extracted_component_count: validatedComponents.length });
      db.close();

      const allWarnings = [...extraction.warnings, ...filterWarnings];
      const summaryLines = [
        `Scanned ${pluralize(sourceFiles.length, 'source file')} in ${sourceDirectory}`,
        `Extracted ${pluralize(extraction.components.length, 'component')}`,
      ];
      if (allWarnings.length > 0) {
        summaryLines.push(`Warnings (${allWarnings.length}):`);
        summaryLines.push(...allWarnings.map((w) => `- ${w}`));
      } else {
        summaryLines.push('Warnings: none');
      }
      process.stderr.write(summaryLines.join('\n') + '\n');
      await exitWithAnalytics(0);
    });
}
