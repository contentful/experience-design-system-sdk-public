import type { AgentRunResult } from '../types/agent-run.js';

/**
 * Build a diagnostic string from a failed agent run, surfacing the agent's
 * own stderr (or stdout, when stderr is empty) so callers never emit a
 * context-free "agent failed".
 */
export function describeAgentFailure(result: AgentRunResult, maxDetail = 800): string {
  const base = result.exitCode !== 0 ? `agent exited with code ${result.exitCode}` : 'agent produced no tool calls';
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-maxDetail).trim();
  return detail ? `${base} — ${detail}` : base;
}
