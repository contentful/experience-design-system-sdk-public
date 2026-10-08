import { OutputFormatter } from '../output-formatter/index.js';
import type { AgentInvoker, InvokeAgentOptions } from '../types/invoker.js';
import type { AgentRunResult } from '../types/agent-run.js';

export interface InvokeAgentWithOutputResult {
  result: AgentRunResult;
  output: string;
}

/**
 * Invoke an agent while streaming its stdout through `OutputFormatter`. The
 * captured raw output is returned alongside the invoker's final result so
 * callers can both display a live summary (via the formatter's stderr writes)
 * and keep the raw stdout for parsing.
 */
export async function invokeAgentWithOutput(
  invoker: AgentInvoker,
  options: Omit<InvokeAgentOptions, 'onOutput'>,
  verbose: boolean,
): Promise<InvokeAgentWithOutputResult> {
  let output = '';
  const formatter = new OutputFormatter(verbose, (chunk) => {
    output += chunk;
  });
  const result = await invoker.invoke({
    ...options,
    onOutput: (chunk) => formatter.push(chunk),
  });
  formatter.flush();
  return { result, output };
}
