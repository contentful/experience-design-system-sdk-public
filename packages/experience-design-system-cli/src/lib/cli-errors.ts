import {
  agentSupportsStdinPrompt,
  binaryExists,
  type AgentName,
} from '@contentful/experience-design-system-generation';
import { exitWithAnalytics } from '../analytics/index.js';

export function die(message: string): never {
  process.stderr.write(`${message}\n`);
  void exitWithAnalytics(1);
  throw new Error('exit');
}

export async function assertBinaryInPath(binary: string): Promise<boolean> {
  // Replaces `which <binary>`, which doesn't exist on Windows. Also matches the
  // `.cmd` shims npm creates there.
  return binaryExists(binary);
}

/**
 * Exit early when the chosen agent can't receive a prompt on this platform.
 *
 * Windows limits a command line to 8191 characters and every skill prompt is
 * larger, so an agent that can only take the prompt as an argument has no way to
 * receive one. Every agent but copilot reads the prompt on stdin instead, where
 * no limit applies.
 */
export function assertAgentCanReceivePrompt(agent: AgentName): void {
  if (process.platform !== 'win32' || agentSupportsStdinPrompt(agent)) return;
  die(
    `Error: --agent ${agent} does not work on Windows.\n` +
      `Its CLI only accepts the prompt as a command-line argument, and Windows limits a command\n` +
      `line to 8191 characters — shorter than the prompts this command sends.\n` +
      `\n` +
      `Every other agent reads the prompt from standard input, so they are unaffected.\n` +
      `Use --agent claude, codex, opencode, or cursor.`,
  );
}
