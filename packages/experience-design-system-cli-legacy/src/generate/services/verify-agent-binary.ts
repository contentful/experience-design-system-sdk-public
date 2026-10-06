import { resolveBinary } from '@contentful/experience-design-system-generation';
import type { AgentName, Skill } from '@contentful/experience-design-system-generation';
import { assertBinaryInPath } from '../../lib/cli-errors.js';
import { exitWithAnalytics } from '../../analytics/index.js';
import { printFallbackInstructions } from '../helpers/print-fallback-instructions.js';

export async function verifyAgentBinary(agent: AgentName, skill: Skill, sessionId: string): Promise<boolean> {
  const binary = resolveBinary(agent);
  if (!(await assertBinaryInPath(binary))) {
    printFallbackInstructions({ agent, skill, sessionId });
    await exitWithAnalytics(1);
    return false;
  }
  return true;
}
