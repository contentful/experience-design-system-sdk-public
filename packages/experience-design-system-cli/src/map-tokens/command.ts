import { createElement } from 'react';
import { render } from 'ink';
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  AGENT_NAMES,
  buildPrompt,
  createLocalCliAgentInvoker,
  describeAgentFailure,
  isAgentName,
  parseMapTokenPropToolCallLines,
  resolveBinary,
  resolveSkillPath,
} from '@contentful/experience-design-system-generation';
import {
  openPipelineDb,
  loadCDFComponents,
  loadDTCGTokens,
  loadComponentSourceRefs,
  computeMapTokensInputHash,
  createStep,
  updateStep,
  findLatestSessionForCommand,
  lookupCache,
  storeCache,
  copyMapTokensFromCache,
  replaceRawTokenNamePaths,
  loadRawTokenNamePathRows,
} from '../session/db.js';
import { hashPromptForSkill } from '../session/cache-keys.js';
import { rebuildDTCGTree } from '../print/command.js';
import { applyMapTokenPropCalls } from './apply.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { bindAnalyticsSessionId, exitWithAnalytics } from '../analytics/index.js';
import { MapTokensView } from './tui/MapTokensView.js';
import type { MapTokensViewResult } from './tui/MapTokensView.js';
import { resolveTokenDefaults } from './resolve-defaults.js';
import { die, assertBinaryInPath } from '../lib/cli-errors.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

interface MapTokensOptions {
  session?: string;
  agent?: string;
  model?: string;
  printPrompt?: boolean;
  cache?: boolean;
  skipAgent?: boolean;
  tokenMap?: string;
}

async function renderResult(result: MapTokensViewResult): Promise<void> {
  if (process.stdout.isTTY) {
    const { waitUntilExit } = render(createElement(MapTokensView, { result, onExit: () => void exitWithAnalytics(0) }));
    await waitUntilExit();
  } else {
    const summary = result.cached ? 'cached' : `${result.applied} mapping(s) applied`;
    process.stdout.write(`map tokens complete\nagent: ${result.agent}\nsession=${result.sessionId}\n${summary}\n`);
    await exitWithAnalytics(0);
  }
}

async function runMapTokens(opts: MapTokensOptions): Promise<void> {
  const savedCreds = await readExperiencesCredentials();
  const agentName = opts.agent ?? savedCreds.agent;
  const model = opts.model ?? savedCreds.agentModel;
  const configuredAgent = agentName && isAgentName(agentName) ? agentName : undefined;
  if (!opts.skipAgent && !configuredAgent) {
    die(
      `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: ${AGENT_NAMES.join(', ')}`,
    );
  }
  const resultAgent = configuredAgent ?? 'skipped';

  const db = openPipelineDb();
  try {
    const sessionId = opts.session ?? findLatestSessionForCommand(db, 'generate components');
    if (!sessionId) {
      die(
        'Error: no completed generate components session found. Run generate components first, or pass --session <id>.',
      );
    }

    await bindAnalyticsSessionId(sessionId);

    const tokenLeaves = db
      .prepare('SELECT path, type FROM raw_tokens WHERE session_id = ? ORDER BY path')
      .all(sessionId) as Array<{ path: string; type: string }>;
    const knownTokenPaths = new Set(tokenLeaves.map((t) => t.path));

    const tokenMapDiagnostics: string[] = [];
    if (opts.tokenMap) {
      const fileMappings = JSON.parse(await readFile(opts.tokenMap, 'utf8')) as Record<string, string>;
      const validMappings: Record<string, string> = {};
      for (const [rawName, path] of Object.entries(fileMappings)) {
        if (knownTokenPaths.has(path)) {
          validMappings[rawName] = path;
        } else {
          tokenMapDiagnostics.push(`Token map '${rawName}' -> '${path}': path not found in session tokens — skipped.`);
        }
      }
      // Replace-all-manual-then-insert, before the automatic pass, so the file
      // is the source of truth for manual mappings on every run.
      replaceRawTokenNamePaths(db, sessionId, validMappings, 'manual');
    }

    // Resolve generated design-token props by their source reference when one
    // was extracted. The rendered default value stays out of this prepass.
    const rawDefaults = db
      .prepare(
        `SELECT rp.default_value AS default_reference, rp.cdf_token_kind
         FROM raw_props rp
         JOIN raw_components rc ON rc.session_id = rp.session_id AND rc.component_id = rp.component_id
         WHERE rp.session_id = ? AND rc.status = 'generated'
           AND rp.cdf_type = 'token' AND rp.cdf_category = 'design'
           AND rp.default_value IS NOT NULL`,
      )
      .all(sessionId) as Array<{
      default_reference: string;
      cdf_token_kind: string | null;
    }>;
    const defaultResolution = resolveTokenDefaults(
      rawDefaults.map((row) => ({
        rawDefault: row.default_reference,
        tokenKind: row.cdf_token_kind,
      })),
      tokenLeaves,
    );
    const manualMappings = new Map(
      loadRawTokenNamePathRows(db, sessionId)
        .filter((row) => row.source === 'manual')
        .map((row) => [row.rawName, row.path]),
    );
    const automaticMappings: Record<string, string> = {};
    const defaultDiagnostics = [
      ...tokenMapDiagnostics,
      ...defaultResolution.diagnostics.map((diagnostic) => diagnostic.message),
    ];
    for (const [rawName, path] of Object.entries(defaultResolution.mappings)) {
      const manualPath = manualMappings.get(rawName);
      if (manualPath === undefined) {
        automaticMappings[rawName] = path;
      } else if (manualPath !== path) {
        defaultDiagnostics.push(
          `Token default '${rawName}' automatically resolves to '${path}', but manual mapping '${manualPath}' is retained.`,
        );
      }
    }
    replaceRawTokenNamePaths(db, sessionId, automaticMappings, 'automatic');
    if (defaultDiagnostics.length > 0) {
      process.stderr.write(
        `Unresolved token defaults:\n${defaultDiagnostics.map((diagnostic) => `  ${diagnostic}`).join('\n')}\n`,
      );
    }

    // Build this projection exactly once after persisting defaults. The same
    // snapshot is used for eligibility and prompt rendering.
    const cdfEntries = loadCDFComponents(db, sessionId);
    if (cdfEntries.length === 0) {
      die(
        `Error: no generated components in session '${sessionId}'. Run generate components first, or pass a different --session.`,
      );
    }

    const mappablePropCount = cdfEntries.reduce(
      (count, { entry }) =>
        count +
        Object.values(entry.$properties ?? {}).filter((prop) => prop.$type === 'token' && prop.$category === 'design')
          .length,
      0,
    );
    const { groups, tokens } = loadDTCGTokens(db, sessionId);
    const tokenCount = tokens.length;
    if (mappablePropCount === 0 || tokenCount === 0) {
      process.stdout.write(
        `Nothing to map: session '${sessionId}' has ${mappablePropCount} design-token prop(s) and ${tokenCount} token(s). Nothing written.\n`,
      );
      await exitWithAnalytics(0);
      return;
    }

    const generatedCdf = Object.fromEntries(cdfEntries.map((c) => [c.key, c.entry]));
    const tokenTree = rebuildDTCGTree(groups, tokens);
    const componentSourceRefs = await loadComponentSourceRefs(db, sessionId);

    if (opts.printPrompt) {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf,
        tokenTree,
        componentSourceRefs,
        outDir: process.cwd(),
      });
      process.stdout.write(prompt + '\n');
      await exitWithAnalytics(0);
      return;
    }

    if (opts.skipAgent) {
      const stepId = createStep(db, sessionId, 'map tokens', {
        agent: resultAgent,
        model: model ?? '',
        skipAgent: 'true',
      });
      updateStep(db, stepId, 'complete', { applied: '0', skipAgent: 'true' });
      await renderResult({ agent: resultAgent, sessionId, applied: 0, cached: false });
      return;
    }

    const agent = configuredAgent!;

    const noCache = opts.cache === false || process.env.EDS_NO_CACHE === '1';
    const promptHash = await hashPromptForSkill('map-tokens', agent, model);
    const inputHash = computeMapTokensInputHash(db, sessionId, componentSourceRefs);

    if (!noCache) {
      const cached = lookupCache(db, inputHash, 'token_mapping', '__map_tokens__', promptHash);
      if (cached) {
        const appliedFromCache = copyMapTokensFromCache(db, cached.sourceSessionId, sessionId);
        const stepId = createStep(db, sessionId, 'map tokens', { agent, model: model ?? '' });
        updateStep(db, stepId, 'complete', { cached: 'true', applied: String(appliedFromCache) });
        await renderResult({ agent, sessionId, applied: appliedFromCache, cached: true });
        return;
      }
    }

    const binary = resolveBinary(agent);
    if (!(await assertBinaryInPath(binary))) {
      die(
        `Error: agent '${agent}' not found in $PATH (looked for binary: ${binary}).\n` +
          `Install it, choose another agent with --agent, or use --print-prompt to run the mapping manually via:\n` +
          `  ${resolveSkillPath('map-tokens')}`,
      );
    }

    const stepId = createStep(db, sessionId, 'map tokens', { agent, model: model ?? '' });

    const prompt = await buildPrompt({
      skill: 'map-tokens',
      mode: 'autonomous',
      generatedCdf,
      tokenTree,
      componentSourceRefs,
      outDir: process.cwd(),
    });

    const invoker = createLocalCliAgentInvoker();
    const result = await invoker.invoke({ agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS });

    if (result.timedOut || result.exitCode !== 0) {
      const error = result.timedOut
        ? `timed out after ${DEFAULT_TIMEOUT_MS / 60000} minutes`
        : describeAgentFailure(result);
      updateStep(db, stepId, 'failed', {}, error);
      die(`Error: map tokens agent failed — ${error}`);
    }

    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCallLines(result.stdout);
    const { applied, warnings } = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);

    if (!noCache) {
      storeCache(db, inputHash, 'token_mapping', '__map_tokens__', sessionId, false, promptHash);
    }

    updateStep(db, stepId, 'complete', { applied: String(applied), warnings: String(warnings.length) });

    if (warnings.length > 0) {
      process.stderr.write(`Warnings:\n${warnings.map((w) => `  ${w}`).join('\n')}\n`);
    }

    await renderResult({ agent, sessionId, applied, cached: false });
  } finally {
    db.close();
  }
}

export function registerMapTokensCommand(program: Command): void {
  const map = program.command('map').description('Suggest token restrictions for generated design-token props');

  const tokensCmd = map
    .command('tokens')
    .description('Invoke a coding agent to suggest $token.allowed for design-category token props')
    .option('--session <id>', 'Session ID from generate components (defaults to most recent)')
    .option('--print-prompt', 'Print the prompt without invoking the agent')
    .option('--skip-agent', 'Resolve token defaults without agentic $token.allowed inference')
    .option('--no-cache', 'Bypass the map-tokens cache and force a re-run')
    .option('--token-map <path>', 'Path to token-name-map.json sidecar');

  addAgentModelOptions(tokensCmd).action(async (opts: MapTokensOptions) => {
    await runMapTokens(opts);
  });
}
