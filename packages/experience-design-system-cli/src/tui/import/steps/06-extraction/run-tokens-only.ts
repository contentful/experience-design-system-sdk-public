import {
  checkAgentAuth,
  runGenerateTokensSession,
  type AgentName,
} from '@contentful/experience-design-system-backend-pipeline';
import { findSkillPath } from './find-skill-path.js';
import { agentAuthMessage } from './logic.js';

const TOKENS_SKILL_PATH = findSkillPath('generate-tokens.md');

export interface TokensOnlyInput {
  rawTokensPath: string;
  /** Where tokens.json is written: this import run's folder. */
  outDir: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  noCache: boolean;
}

export type TokensOnlyResult =
  | { ok: true; tokensPath: string; tokenSessionId: string | null; tokenCount: number }
  | { ok: false; step: 'generate tokens' | `${string} auth check`; message: string };

/** The outside world the stage talks to, so it can be tested without an agent. */
export interface TokensOnlyDeps {
  checkAgentAuth: typeof checkAgentAuth;
  runGenerateTokensSession: typeof runGenerateTokensSession;
}

const realDeps: TokensOnlyDeps = { checkAgentAuth, runGenerateTokensSession };

/**
 * The extraction stage for an import that only generates tokens: the same auth check and token generation the full stage
 * runs, without scanning components, composing them or selecting. The full stage fails when it finds no components, so it
 * cannot be used for this.
 */
export async function runTokensOnly(
  input: TokensOnlyInput,
  deps: TokensOnlyDeps = realDeps,
): Promise<TokensOnlyResult> {
  const auth = await deps.checkAgentAuth(input.agent as AgentName);
  if (auth === 'not-found' || auth === 'unauthenticated') {
    return { ok: false, step: `${input.agent} auth check`, message: agentAuthMessage(input.agent, auth) };
  }
  try {
    const result = await deps.runGenerateTokensSession({
      rawTokensPath: input.rawTokensPath,
      outDir: input.outDir,
      agent: input.agent as AgentName,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: input.promptOverrides,
      skillPath: TOKENS_SKILL_PATH,
      noCache: input.noCache,
    });
    return {
      ok: true,
      tokensPath: result.tokensPath,
      tokenSessionId: result.tokenSessionId,
      tokenCount: result.tokenCount,
    };
  } catch (error) {
    return { ok: false, step: 'generate tokens', message: error instanceof Error ? error.message : String(error) };
  }
}
