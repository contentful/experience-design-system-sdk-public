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
} from '../../session/db.js';
import { hashContent, hashPromptForSkill } from '../../session/cache-keys.js';
import { readExistingContentfulEntitiesFromSession } from '../../helpers/read-existing-contentful-entities-from-session.js';
import { summarizeForMapTokens } from '../../helpers/summarize-existing-contentful-entities.js';
import { resolve } from 'node:path';
import { rebuildDTCGTree } from '../../print/command.js';
import { applyMapTokenPropCalls } from '../apply.js';
import { readExperiencesCredentials } from '../../credentials-store.js';
import { bindAnalyticsSessionId, exitWithAnalytics } from '../../analytics/index.js';
import { die, assertBinaryInPath } from '../../lib/cli-errors.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import { resolveTokenNamePaths } from '../services/resolve-token-name-paths.js';
import { renderMapTokensResult } from '../services/render-map-tokens-result.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export interface MapTokensOptions {
  session?: string;
  agent?: string;
  model?: string;
  printPrompt?: boolean;
  cache?: boolean;
  skipAgent?: boolean;
  tokenMap?: string;
  existingEntitiesPath?: string;
  prompt?: string[];
}

export async function runMapTokens(opts: MapTokensOptions): Promise<void> {
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

  const { overrides: promptOverrides, errors: promptErrors } = parsePromptOverrides(opts.prompt ?? []);
  if (promptErrors.length > 0) die(`Error: ${promptErrors.join('; ')}`);
  const mapPromptOverride = promptOverrides.get('map-tokens');
  let mapPromptText: string | undefined;
  let mapPromptPath: string | undefined;
  if (mapPromptOverride?.kind === 'text') mapPromptText = mapPromptOverride.value;
  if (mapPromptOverride?.kind === 'path') {
    mapPromptPath = resolve(mapPromptOverride.value);
    try {
      await resolvePromptOverride(mapPromptOverride);
    } catch (error) {
      die(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const db = openPipelineDb();
  try {
    const sessionId = opts.session ?? findLatestSessionForCommand(db, 'generate components');
    if (!sessionId) {
      die(
        'Error: no completed generate components session found. Run generate components first, or pass --session <id>.',
      );
    }

    await bindAnalyticsSessionId(sessionId);

    const { diagnostics } = await resolveTokenNamePaths(db, sessionId, opts.tokenMap);

    if (diagnostics.length > 0) {
      process.stderr.write(`Unresolved token defaults:\n${diagnostics.map((d) => `  ${d}`).join('\n')}\n`);
    }

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

    let existingTokensInline: string | undefined;
    if (opts.existingEntitiesPath) {
      const existingContentfulEntities = await readExistingContentfulEntitiesFromSession(
        resolve(opts.existingEntitiesPath),
      );
      if (existingContentfulEntities) {
        existingTokensInline = JSON.stringify(summarizeForMapTokens(existingContentfulEntities));
      } else {
        process.stderr.write(
          `warn: --existing-entities-path ${opts.existingEntitiesPath} could not be read as JSON — proceeding without space-context enrichment\n`,
        );
      }
    }

    const buildMapPrompt = (): Promise<string> =>
      buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf,
        tokenTree,
        componentSourceRefs,
        outDir: process.cwd(),
        existingTokensInline,
        ...(mapPromptText !== undefined ? { skillContentOverride: mapPromptText } : {}),
        ...(mapPromptText === undefined && mapPromptPath ? { skillPathOverride: mapPromptPath } : {}),
      });

    if (opts.printPrompt) {
      const prompt = await buildMapPrompt();
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
      await renderMapTokensResult({ agent: resultAgent, sessionId, applied: 0, cached: false });
      return;
    }

    const agent = configuredAgent!;

    const noCache = opts.cache === false || process.env.EDS_NO_CACHE === '1';
    const promptHash = await hashPromptForSkill(
      'map-tokens',
      agent,
      model,
      undefined,
      existingTokensInline ? [hashContent(existingTokensInline)] : [],
      mapPromptText,
    );
    const inputHash = computeMapTokensInputHash(db, sessionId, componentSourceRefs);

    if (!noCache) {
      const cached = lookupCache(db, inputHash, 'token_mapping', '__map_tokens__', promptHash);
      if (cached) {
        const appliedFromCache = copyMapTokensFromCache(db, cached.sourceSessionId, sessionId);
        const stepId = createStep(db, sessionId, 'map tokens', { agent, model: model ?? '' });
        updateStep(db, stepId, 'complete', { cached: 'true', applied: String(appliedFromCache) });
        await renderMapTokensResult({ agent, sessionId, applied: appliedFromCache, cached: true });
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

    const prompt = await buildMapPrompt();

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

    await renderMapTokensResult({ agent, sessionId, applied, cached: false });
  } finally {
    db.close();
  }
}
