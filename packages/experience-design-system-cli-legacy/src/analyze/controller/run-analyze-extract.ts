import { resolve, join, isAbsolute } from 'node:path';
import { agentSupportsBedrock } from '@contentful/experience-design-system-generation';
import { resolveCompositionSources } from '../composition/resolve-mapping-cli.js';
import { resolveCompositionAgentName } from '../helpers/resolve-composition-agent.js';
import { resolveExtractNoCache } from '../helpers/resolve-no-cache.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import { executeAnalyzeExtractOrchestrator } from '../orchestrator/execute-analyze-extract.js';
import {
  bindAnalyticsSessionId,
  emitSessionStarted,
  exitWithAnalytics,
  isPipelineAnalyticsChild,
} from '../../analytics/index.js';
import { pathExists } from '../../lib/path-exists.js';

export interface AnalyzeExtractOptions {
  project: string;
  dir?: string;
  resolveUnreachable?: string;
  compositionRefresh?: boolean;
  cache?: boolean;
  noCache?: boolean;
  prompt?: string[];
  agent?: string;
  bedrock?: boolean;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function resolveUnreachableMode(value: string | undefined): 'auto' | 'always' | 'never' {
  const v = value ?? 'auto';
  if (v !== 'auto' && v !== 'always' && v !== 'never') {
    process.stderr.write(`Error: --resolve-unreachable must be one of 'auto', 'always', 'never' (got '${v}')\n`);
    process.exit(1);
  }
  return v;
}

async function resolveSourceDirectory(projectRoot: string, dir: string | undefined): Promise<string> {
  if (dir !== undefined) {
    const sourceDirectory = isAbsolute(dir) ? dir : resolve(projectRoot, dir);
    if (!(await pathExists(sourceDirectory))) {
      process.stderr.write(`Error: source directory does not exist: ${sourceDirectory}\n`);
      process.exit(1);
    }
    return sourceDirectory;
  }
  const srcPath = resolve(projectRoot, 'src');
  return (await pathExists(srcPath)) ? srcPath : projectRoot;
}

export async function runAnalyzeExtract(opts: AnalyzeExtractOptions): Promise<void> {
  const noCache = resolveExtractNoCache(opts);
  const resolveUnreachable = resolveUnreachableMode(opts.resolveUnreachable);

  if (opts.bedrock) {
    const bedrockAgent = resolveCompositionAgentName(opts.agent);
    if (!agentSupportsBedrock(bedrockAgent)) {
      process.stderr.write(`Error: --bedrock is not supported for --agent ${bedrockAgent}\n`);
      process.exit(1);
    }
  }

  const projectRoot = resolve(opts.project);
  const outDir = join(projectRoot, '.contentful');
  const sourceDirectory = await resolveSourceDirectory(projectRoot, opts.dir);

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

  const agent = resolveCompositionAgentName(opts.agent);
  const compositionSources = resolveCompositionSources({ compositionRefresh: opts.compositionRefresh, noCache });

  const result = await executeAnalyzeExtractOrchestrator({
    projectRoot,
    sourceDirectory,
    outDir,
    noCache,
    forceAgent: compositionSources.forceAgent,
    agent,
    compositionPrompt,
    resolveUnreachable,
    onScanProgress: (count) => {
      if (!process.stdout.isTTY) process.stderr.write(`progress=scan:${count}\n`);
    },
    onCompositionProgress: (phase) => {
      if (!process.stdout.isTTY) process.stderr.write(`progress=composition:${phase}\n`);
    },
    onSessionCreated: async (sessionId) => {
      await bindAnalyticsSessionId(sessionId);
      if (!isPipelineAnalyticsChild()) await emitSessionStarted('analyze_extract');
      process.stdout.write(`session=${sessionId}\n`);
    },
  });

  if (!process.stdout.isTTY) {
    process.stderr.write(`progress=scan-done:${result.sourceFileCount}\n`);
  }

  const summaryLines = [
    `Scanned ${pluralize(result.sourceFileCount, 'source file')} in ${sourceDirectory}`,
    `Extracted ${pluralize(result.componentCount, 'component')}`,
  ];
  if (result.warnings.length > 0) {
    summaryLines.push(`Warnings (${result.warnings.length}):`);
    summaryLines.push(...result.warnings.map((w) => `- ${w}`));
  } else {
    summaryLines.push('Warnings: none');
  }
  process.stderr.write(summaryLines.join('\n') + '\n');

  await exitWithAnalytics(0);
}
