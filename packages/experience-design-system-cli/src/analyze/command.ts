import { createElement } from 'react';
import { render } from 'ink';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { extractComponents } from './extract/pipeline.js';
import { AnalyzeView } from './tui/AnalyzeView.js';
import type { AnalyzeViewResult } from './tui/AnalyzeView.js';
import { registerAnalyzeEditCommand } from './select/command.js';
import { registerAnalyzeSelectAgentCommand } from './select-agent/command.js';
import { openPipelineDb, getOrCreateSession, createStep, updateStep, storeRawComponents } from '../session/db.js';
import { preClassifyComponent } from './pre-classify.js';
import { isNonAuthorableComponent } from './extract/non-authorable-filter.js';

interface AnalyzeExtractOptions {
  project: string;
  dir?: string;
}

const SCANNED_FILE_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.ts', '.tsx', '.vue']);
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
    .action(async (opts: AnalyzeExtractOptions) => {
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

      const extraction = await extractComponents(sourceFiles, ({ filesProcessed, componentsFound }) => {
        if (!process.stdout.isTTY) {
          process.stderr.write(`progress=extract:${filesProcessed}/${sourceFiles.length}:${componentsFound}\n`);
        }
      });

      await mkdir(outDir, { recursive: true });

      const db = openPipelineDb();
      const { sessionId } = getOrCreateSession(db, undefined, undefined, {
        command: 'analyze extract',
        inputPath: projectRoot,
        outDir,
      });
      const stepId = createStep(db, sessionId, 'analyze extract', { project: projectRoot });
      const classifiedComponents = extraction.components.map(preClassifyComponent);
      const filteredComponents: typeof classifiedComponents = [];
      const filterWarnings: string[] = [];
      for (const component of classifiedComponents) {
        const verdict = isNonAuthorableComponent(component);
        if (verdict.skip) {
          filterWarnings.push(`Skipped non-authorable component: ${component.name} (${verdict.reason})`);
          continue;
        }
        filteredComponents.push(component);
      }
      storeRawComponents(db, sessionId, filteredComponents);
      updateStep(db, stepId, 'complete', { sessionId });
      db.close();

      const allWarnings = [...extraction.warnings, ...filterWarnings];

      const analyzeResult: AnalyzeViewResult = {
        sourceDirectory,
        sessionId,
        fileCount: sourceFiles.length,
        components: filteredComponents.map((c) => ({
          name: c.name,
          framework: c.framework,
          propCount: c.props.length,
          slotCount: c.slots.length,
          warnings: allWarnings.filter((w) => w.startsWith(c.name + ':')),
        })),
        totalWarnings: allWarnings.length,
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
        if (allWarnings.length > 0) {
          summaryLines.push(`Warnings (${allWarnings.length}):`);
          summaryLines.push(...allWarnings.map((w) => `- ${w}`));
        } else {
          summaryLines.push('Warnings: none');
        }
        process.stderr.write(summaryLines.join('\n') + '\n');

        process.exit(0);
      }
    });

  registerAnalyzeEditCommand(analyze);
  registerAnalyzeSelectAgentCommand(analyze);
}
