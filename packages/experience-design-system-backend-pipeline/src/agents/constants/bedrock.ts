import type { AgentName } from '../types/agent-name.js';

/** Per-agent env vars that switch model calls to AWS Bedrock. */
export const BEDROCK_ENV_BY_AGENT: Partial<Record<AgentName, Record<string, string>>> = {
  claude: { CLAUDE_CODE_USE_BEDROCK: '1' },
};

/**
 * Agents with a working Bedrock routing mechanism, of any shape (env var,
 * argv config override, or a provider-prefixed model string) — not just the
 * env-var agents in BEDROCK_ENV_BY_AGENT. cursor is excluded: its own Bedrock
 * support is currently broken for non-interactive/CI use.
 */
export const BEDROCK_CAPABLE_AGENTS = new Set<AgentName>(['claude', 'codex', 'opencode']);

export const DEFAULT_CODEX_BEDROCK_REGION = 'us-east-1';
export const DEFAULT_CODEX_BEDROCK_MODEL = 'openai.gpt-5.6-luna';
