import { createElement } from 'react';
import { render } from 'ink';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import type { TokenTree } from '@contentful/experience-design-system-generation';
import {
  openPipelineDb,
  loadCDFComponents,
  loadDTCGTokens,
  loadComponentSourceRefs,
  computeMapTokensInputHash,
  countMappableTokenProps,
  countRawTokens,
  createStep,
  updateStep,
  findLatestSessionForCommand,
  lookupCache,
  storeCache,
  copyMapTokensFromCache,
} from '../session/db.js';
import { hashPromptForSkill } from '../session/cache-keys.js';
import { rebuildDTCGTree } from '../print/command.js';
import { applyMapTokenPropCalls } from './apply.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { bindAnalyticsSessionId, exitWithAnalytics } from '../analytics/index.js';
import { MapTokensView } from './tui/MapTokensView.js';
import type { MapTokensViewResult } from './tui/MapTokensView.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 3 * 60 * 1000);

interface MapTokensOptions {
  session?: string;
  agent?: string;
  model?: string;
  printPrompt?: boolean;
  cache?: boolean;
}

function die(message: string): never {
  process.stderr.write(`${message}\n`);
  void exitWithAnalytics(1);
  throw new Error('exit');
}

async function assertBinaryInPath(binary: string): Promise<boolean> {
  try {
    await execFileAsync('which', [binary]);
    return true;
  } catch {
    return false;
  }
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
  if (!agentName || !isAgentName(agentName)) {
    die(
      `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: ${AGENT_NAMES.join(', ')}`,
    );
  }
  const agent = agentName;

  const db = openPipelineDb();
  try {
    const sessionId = opts.session ?? findLatestSessionForCommand(db, 'generate components');
    if (!sessionId) {
      die(
        'Error: no completed generate components session found. Run generate components first, or pass --session <id>.',
      );
    }

    await bindAnalyticsSessionId(sessionId);

    // Whether the session was auto-resolved (which already required a completed
    // "generate components" step) or passed explicitly via --session, what actually
    // matters is that the session has real generated CDF component data to map
    // tokens onto — so verify that directly instead of re-checking the steps table.
    const cdfEntries = loadCDFComponents(db, sessionId);
    if (cdfEntries.length === 0) {
      die(
        `Error: no generated components in session '${sessionId}'. Run generate components first, or pass a different --session.`,
      );
    }

    const mappablePropCount = countMappableTokenProps(db, sessionId);
    const tokenCount = countRawTokens(db, sessionId);
    if (mappablePropCount === 0 || tokenCount === 0) {
      process.stdout.write(
        `Nothing to map: session '${sessionId}' has ${mappablePropCount} design-token prop(s) and ${tokenCount} token(s). Nothing written.\n`,
      );
      await exitWithAnalytics(0);
      return;
    }

    const generatedCdf = Object.fromEntries(cdfEntries.map((c) => [c.key, c.entry]));
    const { groups, tokens } = loadDTCGTokens(db, sessionId);
    const tokenTree = rebuildDTCGTree(groups, tokens) as TokenTree;
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

    const noCache = opts.cache === false || process.env.EDS_NO_CACHE === '1';
    const promptHash = await hashPromptForSkill('map-tokens');
    const inputHash = computeMapTokensInputHash(db, sessionId);

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

    if (!noCache && applied > 0) {
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
  const map = program
    .command('map')
    .description('Suggest token sets and restrictions for generated design-token props');

  const tokensCmd = map
    .command('tokens')
    .description('Invoke a coding agent to suggest $token.sets/$token.allowed for design-category token props')
    .option('--session <id>', 'Session ID from generate components (defaults to most recent)')
    .option('--print-prompt', 'Print the prompt without invoking the agent')
    .option('--no-cache', 'Bypass the map-tokens cache and force a re-run');

  addAgentModelOptions(tokensCmd).action(async (opts: MapTokensOptions) => {
    await runMapTokens(opts);
  });
}
