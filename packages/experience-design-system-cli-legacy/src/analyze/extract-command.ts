import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import {
  agentSupportsBedrock,
  DEFAULT_AGENT_NAME,
  isAgentName,
  runExtractAndComposeSession,
  type AgentName,
} from '@contentful/experience-design-system-backend-pipeline';
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
  compositionRefresh?: boolean;
  /** Commander stores a negated --no-cache option as cache=false. */
  cache?: boolean;
  noCache?: boolean;
  prompt?: string[];
  agent?: string;
  bedrock?: boolean;
}

export function resolveExtractNoCache(opts: { cache?: boolean; noCache?: boolean }): boolean {
  return opts.noCache === true || opts.cache === false;
}
const SCANNED_FILE_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);
/**
 * `.json`/`.md` are scanned too (Figma `manifest.json`, `AGENTS.md`-style
 * docs, and other design/composition-adjacent files we don't yet have a name
 * for) — gated by a denylist rather than an allowlist, so coverage isn't
 * capped at a couple of exact filenames. Their content is never inlined into
 * an LLM prompt by virtue of being scanned here; that's a separate gate (see
 * `selectCandidateFiles` in candidate-files.ts) which still only admits files
 * matching its own name/content-marker heuristics. Deterministic parsing
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

/** Resolve which coding-agent runs mapping resolution: `--agent` flag > env > default. */
function resolveCompositionAgentName(flagValue?: string): AgentName {
  if (flagValue && isAgentName(flagValue)) return flagValue;
  const env = process.env['EDS_COMPOSITION_AGENT'];
  if (env && isAgentName(env)) return env;
  return DEFAULT_AGENT_NAME;
}

export function registerInternalExtractCommand(program: Command): void {
  const extractCmd = program
    .command('__extract', { hidden: true })
    .description('Extract component definitions from a project')
    .requiredOption('--project <path>', 'Path to the project root')
    .option('--dir <path>', 'Path to the component source directory relative to the project root')
    .option(
      '--resolve-unreachable <mode>',
      "Retry pass for unresolved Svelte Props types: 'auto' (default), 'always', or 'never'",
      'auto',
    )
    .option('--composition-refresh', 'Force the mapping agent to run even where deterministic sources answered')
    .option('--no-cache', 'Re-run extraction even when all source files are unchanged')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). value is a file path or literal text, e.g. --prompt composition=./p.md',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    );
  addAgentModelOptions(extractCmd, {
    includeModel: false,
    agentDescription: 'Coding agent for composition mapping resolution (claude|codex|opencode|cursor)',
  }).action(async (opts: AnalyzeExtractOptions) => {
    const noCache = resolveExtractNoCache(opts);
    const resolveUnreachable: 'auto' | 'always' | 'never' = (() => {
      const v = opts.resolveUnreachable ?? 'auto';
      if (v !== 'auto' && v !== 'always' && v !== 'never') {
        process.stderr.write(`Error: --resolve-unreachable must be one of 'auto', 'always', 'never' (got '${v}')\n`);
        process.exit(1);
      }
      return v;
    })();
    if (opts.bedrock) {
      const bedrockAgent = resolveCompositionAgentName(opts.agent);
      if (!agentSupportsBedrock(bedrockAgent)) {
        process.stderr.write(`Error: --bedrock is not supported for --agent ${bedrockAgent}\n`);
        process.exit(1);
      }
    }

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

    // Orchestration is now in @contentful/experience-design-system-backend-pipeline.
    // This action keeps the subprocess contract (progress= on stderr,
    // session=<id> on stdout, final summary on stderr, analytics side-effects)
    // byte-identical so anything that still spawns `__extract` keeps working.
    let result: Awaited<ReturnType<typeof runExtractAndComposeSession>>;
    try {
      result = await runExtractAndComposeSession({
        projectPath: projectRoot,
        outDir,
        filePaths: sourceFiles,
        agent: opts.agent ?? '',
        promptOverrides: opts.prompt ?? [],
        noCache,
        resolveUnreachable,
        compositionRefresh: opts.compositionRefresh === true,
        bedrock: opts.bedrock === true,
        onProgress: (event) => {
          if (process.stdout.isTTY) return;
          if (event.kind === 'extract') {
            process.stderr.write(`progress=extract:${event.done}/${event.total}:${event.componentsSoFar}\n`);
          } else if (event.kind === 'composition') {
            process.stderr.write(`progress=composition:${event.phase}\n`);
          }
        },
        onSessionCreated: async (sessionId) => {
          await bindAnalyticsSessionId(sessionId);
          if (!isPipelineAnalyticsChild()) {
            await emitSessionStarted('analyze_extract');
          }
          process.stdout.write(`session=${sessionId}\n`);
        },
        onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
        onExclusion: (exclusion) => getDebugLogger().event('filter', 'extract.excluded', exclusion),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      await exitWithAnalytics(1);
      return;
    }

    for (const w of result.compositionWarnings) {
      process.stderr.write(`Warning: ${w}\n`);
    }
    enrichCommandResult({ extracted_component_count: result.components.length });

    const summaryLines = [
      `Scanned ${pluralize(result.scannedFileCount, 'source file')} in ${sourceDirectory}`,
      `Extracted ${pluralize(result.components.length, 'component')}`,
    ];
    if (result.warnings.length > 0) {
      summaryLines.push(`Warnings (${result.warnings.length}):`);
      summaryLines.push(...result.warnings.map((w) => `- ${w}`));
    } else {
      summaryLines.push('Warnings: none');
    }
    process.stderr.write(summaryLines.join('\n') + '\n');
    await exitWithAnalytics(0);
  });
}
