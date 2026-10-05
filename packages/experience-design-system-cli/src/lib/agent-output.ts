import type { AgentInvoker, InvokeAgentOptions } from '@contentful/experience-design-system-generation';
import { OutputFormatter } from '../output/format.js';

export function createAgentOutputCapture(verbose: boolean): {
  onOutput: (chunk: string) => void;
  finish: () => string;
} {
  let output = '';
  const formatter = new OutputFormatter(verbose, (chunk) => {
    output += chunk;
  });
  return {
    onOutput: (chunk) => formatter.push(chunk),
    finish() {
      formatter.flush();
      return output;
    },
  };
}

export async function invokeAgentWithOutput(
  invoker: AgentInvoker,
  options: Omit<InvokeAgentOptions, 'onOutput'>,
  verbose: boolean,
): Promise<{ result: Awaited<ReturnType<AgentInvoker['invoke']>>; output: string }> {
  const capture = createAgentOutputCapture(verbose);
  const result = await invoker.invoke({ ...options, onOutput: capture.onOutput });
  return { result, output: capture.finish() };
}
