import type { AgentInvoker, AgentName, AgentRunResult } from '@contentful/experience-design-system-generation';

export interface AgentCallOptions {
  invoker: AgentInvoker;
  agent: AgentName;
  model?: string;
  timeoutMs: number;
}

export async function invokeOnce(options: AgentCallOptions, prompt: string, failure: string): Promise<AgentRunResult> {
  const result = await options.invoker.invoke({
    agent: options.agent,
    model: options.model,
    prompt,
    timeoutMs: options.timeoutMs,
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(`${failure}: ${result.stderr || `exit code ${result.exitCode}`}`);
  }
  return result;
}
