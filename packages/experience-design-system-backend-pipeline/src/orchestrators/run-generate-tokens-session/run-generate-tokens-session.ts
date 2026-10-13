import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve as pathResolve } from 'node:path';
import { buildPrompt } from '../../agents/prompts/build-prompt.js';
import { createLocalCliAgentInvoker } from '../../agents/invoker/create-local-cli-agent-invoker.js';
import { invokeAgentWithOutput } from '../../agents/services/invoke-agent-with-output.js';
import { parseTokenToolCalls } from '../../agents/parsers/parse-token-tool-calls.js';
import {
  applyTokenToolCalls,
  computeTokenInputHash,
  copyTokensFromCache,
  getOrCreateSession,
  loadDTCGTokens,
  lookupCache,
  openPipelineDb,
  storeCache,
} from '../../persistence/src/session/repositories/db.js';
import { hashPromptForSkill } from '../../persistence/src/session/helpers/cache-keys.js';
import { rebuildDTCGTree } from '../../steps/shared/dtcg/helpers/rebuild-dtcg-tree.js';
import { parsePromptOverrides } from '../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { resolvePromptOverride } from '../../agents/helpers/prompt-overrides/resolve-prompt-override.js';
import type { RunGenerateTokensSessionRequest, RunGenerateTokensSessionResponse } from './types.js';

export type {
  GenerateTokensProgress,
  RunGenerateTokensSessionRequest,
  RunGenerateTokensSessionResponse,
} from './types.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);
// Legacy __generate tokens uses a 5x timeout for the tokens skill vs the components skill.
const TOKENS_TIMEOUT_MS = DEFAULT_TIMEOUT_MS * 5;

/**
 * Generate DTCG tokens in-process against a pipeline session.
 *
 * Mirrors the legacy `__generate tokens` + `print tokens` subprocess pair:
 *   - mint a token session (`command: 'analyze generate-tokens'`)
 *   - read the raw tokens file inline
 *   - cache lookup by raw-tokens content hash; on hit, copy tokens from source session
 *   - cache miss: build prompt → invoke agent → parse tool calls → applyTokenToolCalls
 *   - rebuild DTCG tree from stored tokens → write `<outDir>/tokens.json`
 *   - store cache entry for future runs
 *
 * The caller (legacy __generate tokens / print tokens wrapper, or v2 TUI step 06)
 * owns:
 *   - CLI flag parsing + input validation
 *   - Analytics session binding + event emission (via onSessionCreated callback)
 *   - Final summary + exit codes
 */
export async function runGenerateTokensSession(
  request: RunGenerateTokensSessionRequest,
): Promise<RunGenerateTokensSessionResponse> {
  const {
    rawTokensPath,
    outDir,
    agent,
    agentModel,
    promptOverrides,
    skillPath,
    noCache,
    bedrock = false,
    onProgress,
    onSessionCreated,
  } = request;

  // Fail-fast on bad prompt-override syntax before DB writes or agent calls.
  const { overrides: overridesMap, errors: promptErrors } = parsePromptOverrides(promptOverrides);
  if (promptErrors.length > 0) throw new Error(`Prompt override error(s): ${promptErrors.join('; ')}`);
  const tokensOverride = overridesMap.get('tokens');
  const skillContentOverride = tokensOverride ? await resolvePromptOverride(tokensOverride) : undefined;

  const rawTokensInline = await readFile(pathResolve(rawTokensPath), 'utf8');
  const tokenInputHash = computeTokenInputHash(rawTokensInline);

  const db = openPipelineDb();
  try {
    const { sessionId: tokenSessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'generate tokens',
      inputPath: pathResolve(rawTokensPath),
      outDir,
    });
    await onSessionCreated?.(tokenSessionId);

    const tokenPromptHash = await hashPromptForSkill('tokens', agent, agentModel, skillPath);
    const warnings: string[] = [];

    onProgress?.({ kind: 'resolving' });

    // Cache lookup — if hit, copy tokens from the source session into ours.
    if (!noCache) {
      const cached = lookupCache(db, tokenInputHash, 'token_set', '__tokens__', tokenPromptHash);
      if (cached) {
        copyTokensFromCache(db, cached.sourceSessionId, tokenSessionId);
        onProgress?.({ kind: 'cache-hit' });
        const { tokensPath, tokenCount } = await writeTokensFile(db, tokenSessionId, outDir, onProgress);
        return { tokenSessionId, tokensPath, tokenCount, warnings };
      }
    }

    // Cache miss — invoke agent.
    onProgress?.({ kind: `agent:${agent}` });

    const prompt = await buildPrompt({
      skill: 'tokens',
      mode: 'autonomous',
      rawTokensInline,
      rawTokensFilename: basename(pathResolve(rawTokensPath)),
      outDir: process.cwd(),
      ...(skillContentOverride ? { skillContentOverride } : skillPath ? { skillPathOverride: skillPath } : {}),
    });

    const invoker = createLocalCliAgentInvoker({});
    const { result } = await invokeAgentWithOutput(
      invoker,
      {
        agent,
        model: agentModel,
        prompt,
        timeoutMs: TOKENS_TIMEOUT_MS,
        bedrock,
      },
      false,
    );
    if (result.timedOut) throw new Error(`token agent did not complete within ${TOKENS_TIMEOUT_MS / 60000} minutes`);
    if (result.exitCode !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      throw new Error(`token agent exited with code ${result.exitCode}`);
    }

    const { calls, warnings: parseWarnings } = parseTokenToolCalls(result.stdout);
    for (const w of parseWarnings) warnings.push(w);

    const tokenCallCount = calls.filter((c) => c.tool === 'set_token').length;
    if (tokenCallCount === 0) {
      throw new Error(`token agent produced no set_token calls.\n\nAgent output:\n${result.stdout}`);
    }

    applyTokenToolCalls(db, tokenSessionId, calls, []);
    if (!noCache) {
      storeCache(db, tokenInputHash, 'token_set', '__tokens__', tokenSessionId, false, tokenPromptHash);
    }

    const { tokensPath, tokenCount } = await writeTokensFile(db, tokenSessionId, outDir, onProgress);
    onProgress?.({ kind: 'done' });

    return { tokenSessionId, tokensPath, tokenCount, warnings };
  } finally {
    db.close();
  }
}

async function writeTokensFile(
  db: ReturnType<typeof openPipelineDb>,
  sessionId: string,
  outDir: string,
  onProgress: RunGenerateTokensSessionRequest['onProgress'],
): Promise<{ tokensPath: string; tokenCount: number }> {
  onProgress?.({ kind: 'writing-file' });
  const result = loadDTCGTokens(db, sessionId);
  if (result.tokens.length === 0) {
    throw new Error(`generate tokens: no tokens persisted for session ${sessionId}`);
  }
  const tree = rebuildDTCGTree(result.groups, result.tokens);
  const tokensPath = join(outDir, 'tokens.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(tokensPath, `${JSON.stringify(tree, null, 2)}\n`);
  return { tokensPath, tokenCount: result.tokens.length };
}
