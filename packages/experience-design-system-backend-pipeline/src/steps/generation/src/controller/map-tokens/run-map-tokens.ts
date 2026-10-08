import { resolve } from 'node:path';
import { buildPrompt } from '../../../../../agents/prompts/build-prompt.js';
import { createLocalCliAgentInvoker } from '../../../../../agents/invoker/create-local-cli-agent-invoker.js';
import { describeAgentFailure } from '../../../../../agents/helpers/metadata/describe-agent-failure.js';
import { resolveBinary } from '../../../../../agents/helpers/resolution/resolve-binary.js';
import { resolveSkillPath } from '../../../../../agents/prompts/resolve-skill-path.js';
import { parseMapTokenPropToolCalls } from '../../../../../agents/parsers/parse-map-token-prop-tool-calls.js';
import type { AgentName } from '../../../../../agents/types/agent-name.js';
import {
  computeMapTokensInputHash,
  copyMapTokensFromCache,
  createStep,
  findLatestSessionForCommand,
  loadCDFComponents,
  loadComponentSourceRefs,
  loadDTCGTokens,
  loadRawTokenNamePathRows,
  lookupCache,
  openPipelineDb,
  replaceRawTokenNamePaths,
  storeCache,
  updateStep,
} from '../../../../../persistence/src/session/repositories/db.js';
import { hashContent, hashPromptForSkill } from '../../../../../persistence/src/session/core/cache-keys.js';
import { binaryExists } from '../../../../../persistence/src/doctor/helpers/binary-exists.js';
import { applyMapTokenPropCalls } from './apply-map-token-prop-calls.js';
import { countMappableProps } from '../../helpers/map-tokens/count-mappable-props.js';
import { loadRawDefaults } from '../../helpers/map-tokens/load-raw-defaults.js';
import { loadTokenLeaves } from '../../helpers/map-tokens/load-token-leaves.js';
import { rebuildDTCGTree } from '../../../../shared/dtcg/helpers/rebuild-dtcg-tree.js';
import { resolveTokenDefaults } from '../../helpers/token-defaults/resolve-token-defaults.js';
import type { MapTokensRunRequest, MapTokensRunResult } from '../../types/map-tokens-run.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class MapTokensRunFailure extends Error {
  constructor(
    public readonly reason:
      | { type: 'no-session' }
      | { type: 'no-components'; sessionId: string }
      | { type: 'binary-not-found'; agent: AgentName; binary: string; skillPath: string }
      | { type: 'agent-failed'; sessionId: string; stepId: number; error: string },
  ) {
    super(MapTokensRunFailure.format(reason));
  }
  static format(
    r:
      | { type: 'no-session' }
      | { type: 'no-components'; sessionId: string }
      | { type: 'binary-not-found'; agent: AgentName; binary: string; skillPath: string }
      | { type: 'agent-failed'; sessionId: string; stepId: number; error: string },
  ): string {
    switch (r.type) {
      case 'no-session':
        return 'no completed generate components session found. Run generate components first, or pass sessionId.';
      case 'no-components':
        return `no generated components in session '${r.sessionId}'. Run generate components first.`;
      case 'binary-not-found':
        return `agent '${r.agent}' not found in $PATH (looked for binary: ${r.binary}). Install it, choose another agent, or run the mapping manually via: ${r.skillPath}`;
      case 'agent-failed':
        return `map tokens agent failed — ${r.error}`;
    }
  }
}

/**
 * Pure orchestration of the map-tokens flow. Reads session state from the DB,
 * resolves token defaults, builds a prompt, optionally invokes the agent, and
 * applies the parsed `map_token_prop` calls back to the DB. Caller handles I/O
 * (prompt file reading, stderr, exit codes).
 */
export async function runMapTokens(request: MapTokensRunRequest): Promise<MapTokensRunResult> {
  const timeoutMs = request.agentTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const db = openPipelineDb();
  try {
    const sessionId = request.sessionId ?? findLatestSessionForCommand(db, 'generate components');
    if (!sessionId) {
      throw new MapTokensRunFailure({ type: 'no-session' });
    }

    const tokenLeaves = loadTokenLeaves(db, sessionId);
    const knownTokenPaths = new Set(tokenLeaves.map((t) => t.path));

    if (request.tokenMapInline) {
      const validMappings: Record<string, string> = {};
      for (const [rawName, path] of Object.entries(request.tokenMapInline)) {
        if (knownTokenPaths.has(path)) validMappings[rawName] = path;
      }
      replaceRawTokenNamePaths(db, sessionId, validMappings, 'manual');
    }

    const rawDefaults = loadRawDefaults(db, sessionId);
    const defaultResolution = resolveTokenDefaults(
      rawDefaults.map((row) => ({ rawDefault: row.default_reference, tokenKind: row.cdf_token_kind })),
      tokenLeaves,
    );

    const manualMappings = new Map(
      loadRawTokenNamePathRows(db, sessionId)
        .filter((row) => row.source === 'manual')
        .map((row) => [row.rawName, row.path]),
    );
    const automaticMappings: Record<string, string> = {};
    for (const [rawName, path] of Object.entries(defaultResolution.mappings)) {
      if (manualMappings.get(rawName) === undefined) automaticMappings[rawName] = path;
    }
    replaceRawTokenNamePaths(db, sessionId, automaticMappings, 'automatic');

    const cdfEntries = loadCDFComponents(db, sessionId);
    if (cdfEntries.length === 0) {
      throw new MapTokensRunFailure({ type: 'no-components', sessionId });
    }

    const mappablePropCount = countMappableProps(cdfEntries);
    const { groups, tokens } = loadDTCGTokens(db, sessionId);
    const tokenCount = tokens.length;
    if (mappablePropCount === 0 || tokenCount === 0) {
      return { type: 'nothing-to-map', sessionId, mappablePropCount, tokenCount };
    }

    const generatedCdf = Object.fromEntries(cdfEntries.map((c) => [c.key, c.entry]));
    const tokenTree = rebuildDTCGTree(groups, tokens);
    const componentSourceRefs = await loadComponentSourceRefs(db, sessionId);

    const buildMapPrompt = (): Promise<string> =>
      buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf,
        tokenTree,
        componentSourceRefs,
        outDir: process.cwd(),
        existingTokensInline: request.existingEntitiesInline,
        ...(request.skillContentOverride !== undefined ? { skillContentOverride: request.skillContentOverride } : {}),
        ...(request.skillContentOverride === undefined && request.skillPathOverride
          ? { skillPathOverride: resolve(request.skillPathOverride) }
          : {}),
      });

    if (request.printPrompt) {
      const prompt = await buildMapPrompt();
      return { type: 'printed-prompt', sessionId, prompt };
    }

    if (request.skipAgent) {
      const stepId = createStep(db, sessionId, 'map tokens', {
        agent: request.agent,
        model: request.model ?? '',
        skipAgent: 'true',
      });
      updateStep(db, stepId, 'complete', { applied: '0', skipAgent: 'true' });
      return { type: 'skipped', sessionId, stepId };
    }

    const agent = request.agent as AgentName;
    const noCache = request.cache === false || process.env['EDS_NO_CACHE'] === '1';
    const promptHash = await hashPromptForSkill(
      'map-tokens',
      agent,
      request.model,
      undefined,
      request.existingEntitiesInline ? [hashContent(request.existingEntitiesInline)] : [],
      request.skillContentOverride,
    );
    const inputHash = computeMapTokensInputHash(db, sessionId, componentSourceRefs);

    if (!noCache) {
      const cached = lookupCache(db, inputHash, 'token_mapping', '__map_tokens__', promptHash);
      if (cached) {
        const applied = copyMapTokensFromCache(db, cached.sourceSessionId, sessionId);
        const stepId = createStep(db, sessionId, 'map tokens', { agent, model: request.model ?? '' });
        updateStep(db, stepId, 'complete', { cached: 'true', applied: String(applied) });
        return { type: 'cached', sessionId, applied, stepId };
      }
    }

    const binary = resolveBinary(agent);
    if (!(await binaryExists(binary))) {
      throw new MapTokensRunFailure({
        type: 'binary-not-found',
        agent,
        binary,
        skillPath: resolveSkillPath('map-tokens'),
      });
    }

    const stepId = createStep(db, sessionId, 'map tokens', { agent, model: request.model ?? '' });
    const prompt = await buildMapPrompt();
    const invoker = createLocalCliAgentInvoker();
    const result = await invoker.invoke({ agent, model: request.model, prompt, timeoutMs });

    if (result.timedOut || result.exitCode !== 0) {
      const error = result.timedOut ? `timed out after ${timeoutMs / 60000} minutes` : describeAgentFailure(result);
      updateStep(db, stepId, 'failed', {}, error);
      throw new MapTokensRunFailure({ type: 'agent-failed', sessionId, stepId, error });
    }

    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCalls(result.stdout);
    const { applied, warnings } = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);

    if (!noCache) {
      storeCache(db, inputHash, 'token_mapping', '__map_tokens__', sessionId, false, promptHash);
    }
    updateStep(db, stepId, 'complete', { applied: String(applied), warnings: String(warnings.length) });

    return { type: 'applied', sessionId, applied, warnings, stepId };
  } finally {
    db.close();
  }
}
