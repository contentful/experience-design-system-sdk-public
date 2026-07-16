import { createElement } from 'react';
import { render } from 'ink';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import { extractComponents } from './extract/pipeline.js';
import { AnalyzeView } from './tui/AnalyzeView.js';
import type { AnalyzeViewResult } from './tui/AnalyzeView.js';
import { registerAnalyzeEditCommand } from './select/command.js';
import { registerAnalyzeSelectAgentCommand } from './select-agent/command.js';
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
import { preClassifyComponent } from './pre-classify.js';
import { isNonAuthorableComponent } from './extract/non-authorable-filter.js';
import { computeExtractionScore, deriveNeedsReview } from './extract/scoring.js';
import { describeReviewReasons, inspectComponentSource } from './extract/source-inspection.js';
import { validateExtractedComponents } from './extract/validate.js';
import { resolveCompositionMode } from '../lib/composition-mode.js';
import { resolveMapping } from './composition/resolve-mapping.js';
import { loadUserMap, resolveCompositionSources } from './composition/resolve-mapping-cli.js';
import { selectCandidateFiles } from './composition/candidate-files.js';
import { buildMappingCacheKey } from './composition/cache-key.js';
import { readRawAgentCache, writeRawAgentCache } from './composition/mapping-cache.js';
import type { InterchangeMap, CompositionEdge } from './composition/interchange-schema.js';
import { runParserInSandbox } from './composition/agent-parser/sandbox.js';
import { resolveViaAgentParser } from './composition/agent-parser/resolve-via-parser.js';
import type { RawSlotDefinition } from '../types.js';
import { parsePromptOverrides, resolvePromptOverride } from '../lib/prompt-overrides.js';
import { runAgent, type AgentName } from '../generate/agent-runner.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { buildAnalyzeViewRows, partitionGlobalWarnings } from './build-analyze-view-rows.js';

interface AnalyzeExtractOptions {
  project: string;
  dir?: string;
  resolveUnreachable?: 'auto' | 'always' | 'never';
  composite?: boolean;
  atomic?: boolean;
  compositionMap?: string;
  compositionAgent?: boolean;
  compositionRefresh?: boolean;
  compositionAgentMode?: string;
  generateMap?: string;
  prompt?: string[];
  agent?: string;
}

const SCANNED_FILE_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.nuxt',
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

function resolveFromProjectRoot(projectRoot: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(projectRoot, inputPath);
}

function wrapperConfidenceToIssueCount(confidence: number): number {
  if (confidence >= 4) return 2;
  if (confidence === 3) return 1;
  return 0;
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
      if (!SCANNED_FILE_EXTENSIONS.has(extension) || entry.name.endsWith('.d.ts')) {
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
async function safeReadCompositionMode(): Promise<'composite' | 'atomic' | undefined> {
  try {
    return (await readExperiencesCredentials()).compositionMode;
  } catch {
    return undefined;
  }
}

/**
 * Build a { version, groups } interchange skeleton (spec T1) from the resolved
 * components' slot allowedComponents — reflecting BOTH typed-slot edges the
 * extractor found and anything the mapping resolver added.
 */
export function componentsToInterchangeMap(
  components: Array<{ name: string; slots: RawSlotDefinition[] }>,
): InterchangeMap {
  const groups: Record<string, string[]> = {};
  for (const c of components) {
    const children = new Set<string>();
    for (const slot of c.slots) {
      for (const child of slot.allowedComponents ?? []) children.add(child);
    }
    if (children.size > 0) groups[c.name] = [...children].sort();
  }
  const sorted: Record<string, string[]> = {};
  for (const parent of Object.keys(groups).sort()) sorted[parent] = groups[parent];
  return { version: 1, groups: sorted };
}

/** Resolve which coding-agent runs mapping resolution: `--agent` flag > env > default. */
function resolveCompositionAgentName(flagValue?: string): AgentName {
  const valid: AgentName[] = ['claude', 'codex', 'opencode', 'cursor'];
  if (flagValue && (valid as string[]).includes(flagValue)) return flagValue as AgentName;
  const env = process.env['EDS_COMPOSITION_AGENT'];
  if (env && (valid as string[]).includes(env)) return env as AgentName;
  return 'claude';
}

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

export function registerAnalyzeCommand(program: Command): void {
  const analyze = program
    .command('analyze')
    .description('Extract component definitions from a project, or correct analysis output');

  analyze
    .command('extract')
    .description('Extract component definitions from a project')
    .requiredOption('--project <path>', 'Path to the project root')
    .option('--dir <path>', 'Path to the component source directory relative to the project root')
    .option(
      '--resolve-unreachable <mode>',
      "Retry pass for unresolved Svelte Props types: 'auto' (default), 'always', or 'never'",
      'auto',
    )
    .option('--composite', 'Resolve embedded-component composition (opt in; default is atomic)')
    .option('--atomic', 'Skip composition resolution — flat components only (default)')
    .option('--composition-map <path>', 'Consume a hand-authored parent→children interchange map (implies --composite)')
    .option(
      '--composition-agent',
      'Opt into agentic mapping resolution when deterministic sources find no groups (implies --composite)',
    )
    .option(
      '--composition-refresh',
      'Force the mapping agent to run even where deterministic sources answered (implies --composite)',
    )
    .option('--generate-map <path>', 'Write a skeleton interchange map from resolved composition (implies --composite)')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). value is a file path or literal text, e.g. --prompt composition=./p.md',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('--agent <name>', 'Coding agent for composition mapping resolution (claude|codex|opencode|cursor)')
    .option(
      '--composition-agent-mode <mode>',
      "Agent resolution mode: 'parser' (agent writes a sandboxed parser — deterministic, default) or 'edges' (agent lists edges directly)",
      'parser',
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
      const stepId = createStep(db, sessionId, 'analyze extract', {
        project: projectRoot,
      });
      const classifiedComponents = extraction.components.map(preClassifyComponent);
      const inspectedComponents = await Promise.all(
        classifiedComponents.map(async (component) => ({
          component,
          inspection: await inspectComponentSource(component),
        })),
      );
      const filteredComponents: typeof classifiedComponents = [];
      const filterWarnings: string[] = [];
      for (const { component, inspection } of inspectedComponents) {
        const verdict = isNonAuthorableComponent(component);
        const keepDespiteZeroSurface =
          verdict.skip && verdict.reason === 'component has no props and no slots' && inspection.keepDespiteZeroSurface;

        if (verdict.skip && !keepDespiteZeroSurface) {
          filterWarnings.push(`Skipped non-authorable component: ${component.name} (${verdict.reason})`);
          continue;
        }

        if (keepDespiteZeroSurface) {
          filterWarnings.push(
            `${component.name}: retained despite 0 props/slots because the source renders visible or compositional UI`,
          );
        }

        if (inspection.reviewReasons.length > 0) {
          const reviewNotes = describeReviewReasons(inspection.reviewReasons)
            .filter((note) => note !== 'high-confidence data-fetch wrapper')
            .join('; ');
          if (reviewNotes) {
            filterWarnings.push(`${component.name}: ${reviewNotes}`);
          }
        }

        // Preserve any extractor-level review reasons (e.g. `props-type-unresolved`
        // from the Svelte parser) by merging them into the post-processing recompute.
        // Without this, recomputing here clobbers the per-extractor signal.
        const extractorReasons = component.reviewReasons ?? [];
        const { confidence, reasons } = computeExtractionScore(component, {
          additionalIssueCount: wrapperConfidenceToIssueCount(inspection.wrapperConfidence) + extractorReasons.length,
          additionalReasons: [...extractorReasons, ...inspection.reviewReasons],
        });
        filteredComponents.push({
          ...component,
          extractionConfidence: confidence,
          reviewReasons: reasons,
          needsReview:
            deriveNeedsReview(confidence) ||
            inspection.wrapperConfidence >= 4 ||
            inspection.keepDespiteZeroSurface ||
            // An extractor-level type-resolution failure is a strong signal regardless
            // of the otherwise-derived confidence threshold; force review.
            extractorReasons.includes('props-type-unresolved') ||
            (component.needsReview ?? false),
        });
      }
      let validatedComponents = validateExtractedComponents(filteredComponents);

      // Composition mapping resolution (spec U2). Only in composite mode and
      // only when a source is provided (user map / agent opt-in).
      // Atomic (default) never resolves — it would only be stripped later.
      const compositionMode = resolveCompositionMode(opts, (await safeReadCompositionMode()) ?? undefined);
      if (compositionMode === 'composite') {
        const sources = resolveCompositionSources(opts);

        const { overrides: promptOverrides, errors: promptErrors } = parsePromptOverrides(opts.prompt ?? []);
        for (const err of promptErrors) {
          process.stderr.write(`Error: ${err}\n`);
          process.exit(1);
        }
        let compositionPrompt: string | undefined;
        const compositionOverride = promptOverrides.get('composition');
        if (compositionOverride) {
          try {
            compositionPrompt = await resolvePromptOverride(compositionOverride);
          } catch (e) {
            process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
            process.exit(1);
          }
        }

        let userMap;
        if (opts.compositionMap) {
          const loaded = await loadUserMap(opts.compositionMap);
          if (!loaded.ok) {
            process.stderr.write(`Error: ${loaded.error}\n`);
            process.exit(1);
          }
          userMap = loaded.map;
        }

        const hasSource = !!userMap || sources.useAgent || sources.forceAgent;
        if (hasSource || opts.generateMap) {
          // Composition progress mirrors the scan/extract progress convention:
          // emit `progress=composition:<phase>` on stderr so the wizard can
          // render a second progress line during the (potentially slow, agent-
          // backed) resolution instead of appearing frozen.
          const emitCompositionProgress = (phase: string): void => {
            if (!process.stdout.isTTY) process.stderr.write(`progress=composition:${phase}\n`);
          };

          emitCompositionProgress('resolving');
          const allFiles = await readCandidateFiles(validatedComponents, sourceFiles);
          // Decouple the two file sets (design: candidate-heuristic fragility):
          //  - `promptFiles`: a bounded candidate SAMPLE inlined into the agent
          //    prompt so it sees the convention without ingesting the whole repo.
          //  - `allFiles`: EVERY scanned file, handed to the authored parser at
          //    runtime. The parser is deterministic code — give it everything so
          //    a candidate-filter miss can never starve it of a definition file.
          const promptFiles = selectCandidateFiles(allFiles).map((c) => ({ path: c.path, content: c.content }));
          const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));

          const resolverAgent = resolveCompositionAgentName(opts.agent);
          const parserMode = (opts.compositionAgentMode ?? 'parser') !== 'edges';
          const componentNameSet = new Set(validatedComponents.map((c) => c.name));

          const spawnAgent = async (prompt: string): Promise<string> => {
            const res = await runAgent({
              agent: resolverAgent,
              prompt,
              interactive: false,
              timeoutMs: 120_000,
              promptViaStdin: true,
            });
            return res.stdout;
          };

          // Agent-authored parser path (default): the agent writes a sandboxed
          // (ctx) => Edge[] parser we run deterministically, cached by parser
          // SOURCE. Falls back to direct edge-emission if authoring fails.
          let parserEdges: CompositionEdge[] | undefined;
          if (sources.useAgent && parserMode) {
            const parserCacheKey =
              buildMappingCacheKey({ files: runtimeFiles, producer: { kind: 'agent', agent: resolverAgent } }) +
              '-parser';
            const cachedSource = opts.compositionRefresh ? null : await readRawAgentCache(parserCacheKey);
            if (cachedSource !== null) {
              emitCompositionProgress('cache-hit');
              const ran = await runParserInSandbox(cachedSource, {
                files: runtimeFiles,
                componentNames: [...componentNameSet],
              });
              if (!ran.error) {
                parserEdges = ran.edges.filter((e) => componentNameSet.has(e.parent) && componentNameSet.has(e.child));
              }
            }
            if (parserEdges === undefined) {
              const pr = await resolveViaAgentParser({
                files: promptFiles,
                runtimeFiles,
                componentNames: componentNameSet,
                runAgentFn: ({ prompt }) => spawnAgent(prompt),
                ...(compositionPrompt ? { instructionOverride: compositionPrompt } : {}),
                onPhase: (phase) => emitCompositionProgress(phase),
              });
              for (const w of pr.warnings) process.stderr.write(`Warning: composition — ${w}\n`);
              if (!pr.usedFallback) {
                parserEdges = pr.edges;
                if (pr.parserSource) await writeRawAgentCache(parserCacheKey, pr.parserSource);
              } else {
                process.stderr.write('Warning: composition — parser mode failed; falling back to edge emission\n');
              }
            }
          }

          if (process.env['EDS_DEBUG'] && parserEdges) {
            process.stderr.write(
              `[composition-debug] prompt files: ${promptFiles.length}; runtime files: ${runtimeFiles.length}; componentNames: ${componentNameSet.size}; parser edges: ${parserEdges.length}\n`,
            );
            for (const e of parserEdges) process.stderr.write(`[composition-debug]   edge ${e.parent} -> ${e.child}\n`);
          }

          // Edge-emission cache (used for both explicit edges-mode and the
          // parser-mode fallback). Keyed on prompt files + agent identity — the
          // agent emits edges directly from what it reads in the prompt.
          const agentCacheKey = buildMappingCacheKey({
            files: promptFiles,
            producer: { kind: 'agent', agent: resolverAgent },
          });
          const useEdgeEmission = sources.useAgent && parserEdges === undefined;
          const result = await resolveMapping({
            components: validatedComponents,
            ...(userMap ? { userMap } : {}),
            ...(parserEdges ? { extraEdges: parserEdges } : {}),
            useAgent: useEdgeEmission,
            forceAgent: sources.forceAgent && useEdgeEmission,
            files: promptFiles,
            ...(compositionPrompt ? { promptOverride: compositionPrompt } : {}),
            runAgentFn: async ({ prompt }) => {
              if (!opts.compositionRefresh) {
                const cached = await readRawAgentCache(agentCacheKey);
                if (cached !== null) {
                  emitCompositionProgress('cache-hit');
                  return cached;
                }
              }
              emitCompositionProgress(`agent:${resolverAgent}`);
              const stdout = await spawnAgent(prompt);
              await writeRawAgentCache(agentCacheKey, stdout);
              return stdout;
            },
          });
          emitCompositionProgress('done');

          for (const w of result.warnings) process.stderr.write(`Warning: composition — ${w}\n`);
          for (const c of result.conflicts) {
            process.stderr.write(
              `Warning: composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}\n`,
            );
          }

          validatedComponents = result.components as typeof validatedComponents;

          if (opts.generateMap) {
            // Reflect the FULL resolved composition — typed-slot edges already
            // on the extracted components PLUS anything the resolver added — not
            // just the resolver's own contributed edges.
            const skeleton = componentsToInterchangeMap(validatedComponents);
            await writeFile(opts.generateMap, JSON.stringify(skeleton, null, 2) + '\n');
            process.stderr.write(`Wrote composition map skeleton to ${opts.generateMap}\n`);
          }
        }
      }

      storeRawComponents(db, sessionId, validatedComponents);

      const cycleInput = validatedComponents.map((c) => ({
        name: c.name,
        slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
      }));
      const cycles = findSlotCycles(cycleInput);
      const withBreaks = cycles.map((cycle) => ({
        ...cycle,
        suggestedBreak: suggestCycleBreakEdge(cycle, cycles),
      }));
      storeSlotCycles(db, sessionId, withBreaks);

      storeScannedFiles(
        db,
        sessionId,
        sourceFiles.map((f) => relative(projectRoot, f)),
      );
      updateStep(db, stepId, 'complete', { sessionId });
      db.close();

      const allWarnings = [...extraction.warnings, ...filterWarnings];

      const { rows: componentRows, totalErrors } = buildAnalyzeViewRows(
        filteredComponents,
        validatedComponents,
        allWarnings,
      );

      // Split warnings: per-component (those whose prefix matches a surviving component name)
      // are rendered under that component in the TUI; global ones (retry summaries,
      // non-authorable skips, anything else) are rendered at the top of the warnings panel
      // so they don't disappear into the count. `partitionGlobalWarnings` shares its
      // matching rule with `buildAnalyzeViewRows` to keep the two halves symmetric.
      const globalWarnings = partitionGlobalWarnings(
        allWarnings,
        componentRows.map((r) => r.name),
      );

      const analyzeResult: AnalyzeViewResult = {
        sourceDirectory,
        sessionId,
        fileCount: sourceFiles.length,
        components: componentRows,
        totalWarnings: allWarnings.length,
        totalErrors,
        globalWarnings,
      };

      if (process.stdout.isTTY) {
        const { waitUntilExit } = render(
          createElement(AnalyzeView, {
            result: analyzeResult,
            onExit: () => process.exit(0),
          }),
        );
        await waitUntilExit();
      } else {
        const sessionLine = `session=${sessionId}\n`;
        process.stdout.write(sessionLine);

        const summaryLines = [
          `Scanned ${pluralize(sourceFiles.length, 'source file')} in ${sourceDirectory}`,
          `Extracted ${pluralize(extraction.components.length, 'component')}`,
        ];
        if (totalErrors > 0) {
          summaryLines.push(`Errors (${totalErrors}):`);
          for (const c of componentRows) {
            for (const e of c.errors) {
              summaryLines.push(`- ${c.name}: ${e}`);
            }
          }
        }
        if (allWarnings.length > 0) {
          summaryLines.push(`Warnings (${allWarnings.length}):`);
          summaryLines.push(...allWarnings.map((w) => `- ${w}`));
        } else if (totalErrors === 0) {
          summaryLines.push('Warnings: none');
        }
        process.stderr.write(summaryLines.join('\n') + '\n');

        process.exit(0);
      }
    });

  registerAnalyzeEditCommand(analyze);
  registerAnalyzeSelectAgentCommand(analyze);
}
