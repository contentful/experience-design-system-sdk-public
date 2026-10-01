import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { extractEndpoint } from '@contentful/experience-design-system-extraction';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  updateStep,
  storeRawComponents,
  storeScannedFiles,
  storeSlotCycles,
  getCliCacheVersion,
  lookupCompositionCache,
  storeCompositionCache,
} from '../session/db.js';
import { findSlotCycles, suggestCycleBreakEdge } from './cycle-detection.js';
import { resolveMapping } from './composition/resolve-mapping.js';
import { loadUserMap, resolveCompositionSources } from './composition/resolve-mapping-cli.js';
import { selectCandidateFiles, capCandidatesToPromptBudget } from './composition/candidate-files.js';
import { buildCompositionInputHash } from './composition/composition-cache-key.js';
import { collectManifestDocEdges } from './composition/manifest-doc-evidence.js';
import type { InterchangeMap } from './composition/interchange-schema.js';
import { parsePromptOverrides, resolvePromptOverride } from '../lib/prompt-overrides.js';
import {
  agentSupportsBedrock,
  DEFAULT_AGENT_NAME,
  isAgentName,
  runAgent,
  type AgentName,
} from '@contentful/experience-design-system-generation';
import {
  bindAnalyticsSessionId,
  emitSessionStarted,
  enrichCommandResult,
  isPipelineAnalyticsChild,
} from '../analytics/index.js';
import { getDebugLogger } from '../lib/debug-logger.js';

export type ExtractEndpointProgress =
  | { phase: 'scan'; scanned: number }
  | { phase: 'extract'; filesProcessed: number; totalFiles: number; componentsFound: number }
  | { phase: 'composition'; status: string };

export interface ExtractEndpointOptions {
  project: string;
  dir?: string;
  resolveUnreachable?: 'auto' | 'always' | 'never';
  compositionRefresh?: boolean;
  compositionMap?: string;
  prompt?: string[];
  agent?: string;
  bedrock?: boolean;
  onProgress?: (progress: ExtractEndpointProgress) => void;
}

export interface ExtractEndpointResult {
  sessionId: string;
  projectRoot: string;
  sourceDirectory: string;
  sourceFiles: string[];
  extractedComponentCount: number;
  componentCount: number;
  warnings: string[];
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
/** Resolve which coding-agent runs mapping resolution: `--agent` flag > env > default. */
function resolveCompositionAgentName(flagValue?: string): AgentName {
  if (flagValue && isAgentName(flagValue)) return flagValue;
  const env = process.env['EDS_COMPOSITION_AGENT'];
  if (env && isAgentName(env)) return env;
  return DEFAULT_AGENT_NAME;
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

export async function extractProject(opts: ExtractEndpointOptions): Promise<ExtractEndpointResult> {
  const resolveUnreachable = opts.resolveUnreachable ?? 'auto';
  if (resolveUnreachable !== 'auto' && resolveUnreachable !== 'always' && resolveUnreachable !== 'never') {
    throw new Error(`--resolve-unreachable must be one of 'auto', 'always', or 'never' (got '${resolveUnreachable}')`);
  }

  if (opts.bedrock) {
    const bedrockAgent = resolveCompositionAgentName(opts.agent);
    if (!agentSupportsBedrock(bedrockAgent)) {
      throw new Error(`--bedrock is not supported for --agent ${bedrockAgent}`);
    }
  }

  const projectRoot = resolve(opts.project);
  const outDir = join(projectRoot, '.contentful');

  let sourceDirectory: string;
  if (opts.dir !== undefined) {
    sourceDirectory = resolveFromProjectRoot(projectRoot, opts.dir);
    if (!(await pathExists(sourceDirectory))) {
      throw new Error(`source directory does not exist: ${sourceDirectory}`);
    }
  } else {
    const srcPath = resolveFromProjectRoot(projectRoot, 'src');
    sourceDirectory = (await pathExists(srcPath)) ? srcPath : projectRoot;
  }

  const sourceFiles = await collectSourceFiles(sourceDirectory, (scanned) => {
    opts.onProgress?.({ phase: 'scan', scanned });
  });

  const extraction = await extractEndpoint({
    filePaths: sourceFiles,
    projectRoot,
    resolveUnreachable,
    onProgress: (progress) => opts.onProgress?.(progress),
  });

  await mkdir(outDir, { recursive: true });

  const db = openPipelineDb();
  try {
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

    let validatedComponents = extraction.components;
    const warnings = [...extraction.warnings];

    const sources = resolveCompositionSources(opts);
    let userMap: InterchangeMap | undefined;
    if (opts.compositionMap) {
      const loaded = await loadUserMap(opts.compositionMap);
      if (!loaded.ok) throw new Error(loaded.error);
      userMap = loaded.map;
    }

    const { overrides: promptOverrides, errors: promptErrors } = parsePromptOverrides(opts.prompt ?? []);
    if (promptErrors.length > 0) throw new Error(promptErrors.join('; '));

    let compositionPrompt: string | undefined;
    const compositionOverride = promptOverrides.get('composition');
    if (compositionOverride) {
      compositionPrompt = await resolvePromptOverride(compositionOverride);
    }

    // Composition resolution remains part of the extraction endpoint because its
    // evidence enriches the raw component contract before scope review.
    const emitCompositionProgress = (status: string): void => {
      opts.onProgress?.({ phase: 'composition', status });
    };

    emitCompositionProgress('resolving');
    const allFiles = await readCandidateFiles(validatedComponents, sourceFiles);
    const selectedCandidates = selectCandidateFiles(allFiles).map((c) => ({ path: c.path, content: c.content }));
    const capped = capCandidatesToPromptBudget(selectedCandidates);
    const promptFiles = capped.kept;
    if (capped.dropped.length > 0) {
      warnings.push(
        `composition: ${capped.dropped.length} candidate file(s) omitted from the agent prompt to fit the context budget; resolution runs on the ${promptFiles.length} highest-value files`,
      );
    }
    const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));

    const resolverAgent = resolveCompositionAgentName(opts.agent);
    const componentNameSet = new Set(validatedComponents.map((c) => c.name));
    const cacheVersion = await getCliCacheVersion();
    let lastAgentExitCode = 0;
    const spawnAgent = async (prompt: string): Promise<string> => {
      const res = await runAgent({
        agent: resolverAgent,
        prompt,
        timeoutMs: 120_000,
        promptViaStdin: true,
        onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
      });
      lastAgentExitCode = res.exitCode;
      if (res.exitCode !== 0 && res.stderr.trim()) {
        warnings.push(`composition: agent exited ${res.exitCode}: ${res.stderr.trim()}`);
      }
      return res.stdout;
    };

    const manifestDocEdges = collectManifestDocEdges(runtimeFiles, validatedComponents, componentNameSet);
    const agentCacheKey = buildCompositionInputHash({
      files: promptFiles,
      agent: resolverAgent,
    });
    const result = await resolveMapping({
      components: validatedComponents,
      ...(userMap ? { userMap } : {}),
      ...(manifestDocEdges.length > 0 ? { extraEdges: manifestDocEdges } : {}),
      forceAgent: sources.forceAgent,
      files: promptFiles,
      ...(compositionPrompt ? { promptOverride: compositionPrompt } : {}),
      runAgentFn: async ({ prompt }) => {
        if (!opts.compositionRefresh) {
          const cached = lookupCompositionCache(db, agentCacheKey, cacheVersion);
          if (cached !== null) {
            emitCompositionProgress('cache-hit');
            return cached;
          }
        }
        emitCompositionProgress(`agent:${resolverAgent}`);
        const stdout = await spawnAgent(prompt);
        if (lastAgentExitCode === 0) {
          storeCompositionCache(db, agentCacheKey, cacheVersion, stdout);
        }
        return stdout;
      },
    });
    emitCompositionProgress('done');

    warnings.push(...result.warnings.map((warning) => `composition: ${warning}`));
    warnings.push(
      ...result.conflicts.map(
        (conflict) =>
          `composition conflict on ${conflict.parent}→${conflict.child}: kept ${conflict.winner}, dropped ${conflict.loser}`,
      ),
    );
    validatedComponents = result.components as typeof validatedComponents;

    storeRawComponents(db, sessionId, validatedComponents);

    const cycleInput = validatedComponents.map((component) => ({
      name: component.name,
      slots: component.slots.map((slot) => ({
        name: slot.name,
        allowedComponents: slot.allowedComponents,
      })),
    }));
    const cycles = findSlotCycles(cycleInput);
    storeSlotCycles(
      db,
      sessionId,
      cycles.map((cycle) => ({
        ...cycle,
        suggestedBreak: suggestCycleBreakEdge(cycle, cycles),
      })),
    );

    storeScannedFiles(
      db,
      sessionId,
      sourceFiles.map((filePath) => relative(projectRoot, filePath)),
    );
    updateStep(db, stepId, 'complete', { sessionId });
    enrichCommandResult({ extracted_component_count: validatedComponents.length });

    return {
      sessionId,
      projectRoot,
      sourceDirectory,
      sourceFiles,
      extractedComponentCount: extraction.components.length,
      componentCount: validatedComponents.length,
      warnings,
    };
  } finally {
    db.close();
  }
}
