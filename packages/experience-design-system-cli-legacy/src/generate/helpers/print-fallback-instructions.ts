import { resolveBinary, resolveSkillPath } from '@contentful/experience-design-system-generation';
import type { AgentName, Skill } from '@contentful/experience-design-system-generation';
import { assertBinaryInPath } from '../../lib/cli-errors.js';
import { exitWithAnalytics } from '../../analytics/index.js';

export async function assertBinaryOrExit(agent: AgentName, skill: Skill, sessionId: string): Promise<boolean> {
  const binary = resolveBinary(agent);
  if (!(await assertBinaryInPath(binary))) {
    printFallbackInstructions({ agent, skill, sessionId });
    await exitWithAnalytics(1);
    return false;
  }
  return true;
}

export function printFallbackInstructions(options: { agent: string; skill: Skill; sessionId: string }): void {
  const binary = resolveBinary(options.agent as AgentName);
  const skillPath = resolveSkillPath(options.skill);
  const lines = [
    `Error: agent '${options.agent}' not found in $PATH (looked for binary: ${binary}).`,
    `Install it or use one of: claude, codex, opencode, cursor`,
    ``,
    `To run the generation step manually:`,
    ``,
    `  1. Open your coding agent`,
    `  2. Run this skill (all input data will be embedded inline):`,
    `       ${skillPath}`,
    ``,
    `  Use --dry-run to print the full prompt including all inline data.`,
    ``,
    `  When done, the agent output must be stored in the session database.`,
    `  Re-run the generate command with the agent available, or use --dry-run to inspect the prompt.`,
  ];
  process.stderr.write(lines.join('\n') + '\n');
}
