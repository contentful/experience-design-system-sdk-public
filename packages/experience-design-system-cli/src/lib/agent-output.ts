import type { AgentInvoker, InvokeAgentOptions } from '@contentful/experience-design-system-generation';
import { OutputFormatter } from '../output/format.js';

export async function invokeAgentWithOutput(
  invoker: AgentInvoker,
  options: Omit<InvokeAgentOptions, 'onOutput'>,
  verbose: boolean,
): Promise<{ result: Awaited<ReturnType<AgentInvoker['invoke']>>; output: string }> {
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
