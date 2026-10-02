import type { AgentRunResult } from '../model/invocation.js';

export function describeAgentFailure(result: AgentRunResult, maxDetail = 800): string {
  const base = result.exitCode !== 0 ? `agent exited with code ${result.exitCode}` : 'agent produced no tool calls';
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-maxDetail).trim();
  return detail ? `${base} — ${detail}` : base;
}
