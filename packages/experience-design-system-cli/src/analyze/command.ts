import { createElement } from 'react';
import { render } from 'ink';
import { mkdir, readdir, stat } from 'node:fs/promises';
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
import { buildAnalyzeViewRows, partitionGlobalWarnings } from './build-analyze-view-rows.js';

interface AnalyzeExtractOptions {
  project: string;
  dir?: string;
  resolveUnreachable?: 'auto' | 'always' | 'never';
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
      const validatedComponents = validateExtractedComponents(filteredComponents);
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
