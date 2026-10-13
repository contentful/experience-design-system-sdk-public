import type { AgentName } from '../../agents/types/agent-name.js';
import type { AgentDebugEvent } from '../../agents/types/agent-run.js';

/**
 * Structured progress events emitted during token generation. Mirrors the
 * extract-and-compose orchestrator's event shape so TUI progress code can
 * handle both the same way.
 */
export type GenerateTokensProgress =
  | { kind: 'resolving' }
  | { kind: 'cache-hit' }
  | { kind: `agent:${string}` }
  | { kind: 'writing-file' }
  | { kind: 'done' };

export interface RunGenerateTokensSessionRequest {
  /** Absolute path to the user's raw tokens file (TS, JS, or JSON). */
  rawTokensPath: string;
  /** Absolute path to the session's output directory. `tokens.json` is written at `<outDir>/tokens.json`. */
  outDir: string;
  /** Coding agent that produces the DTCG tool-call stream. */
  agent: AgentName;
  /** Optional explicit model. */
  agentModel?: string;
  /** `--prompt stage=value` overrides, repeatable, as passed through from CLI/TUI. */
  promptOverrides: string[];
  /**
   * Absolute path to the skill markdown file the agent runs. Supplied by the
   * caller because the layout of the shipped `skills/` directory varies by
   * package (cli-legacy nests it, v2 cli flattens it). Falls back to the
   * backend-pipeline-local walk-up when omitted.
   */
  skillPath?: string;
  /** When true: skip the token-generation cache, force the agent to re-run. */
  noCache: boolean;
  /** When true: enable Bedrock env for the token agent (gated on agentSupportsBedrock). */
  bedrock?: boolean;
  /** Fires when a structured progress event occurs. */
  onProgress?: (event: GenerateTokensProgress) => void;
  /** Fires exactly once with the newly-minted token session id, as early as possible. Awaited. */
  onSessionCreated?: (tokenSessionId: string) => void | Promise<void>;
  /** Optional debug event sink. */
  onDebugEvent?: AgentDebugEvent;
}

export interface RunGenerateTokensSessionResponse {
  /** Pipeline token session id. Downstream commands read tokens by this id. */
  tokenSessionId: string;
  /** Absolute path to the written tokens.json file (`<outDir>/tokens.json`). */
  tokensPath: string;
  /** Count of DTCG tokens produced. */
  tokenCount: number;
  /** Warnings from the agent run (empty on cache hit). */
  warnings: string[];
}
