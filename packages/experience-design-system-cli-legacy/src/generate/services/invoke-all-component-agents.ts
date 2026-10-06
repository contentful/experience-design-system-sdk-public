import { formatGenerateProgressLine } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '../../types.js';
import { c } from '../../output/format.js';
import { invokeComponentAgent } from './invoke-component-agent.js';
import type { ComponentAgentOptions, ComponentRunResult } from './invoke-component-agent.js';

export type { ComponentAgentOptions, ComponentRunResult };

const DEFAULT_COMPONENT_CONCURRENCY = 10;

export async function invokeAllComponentAgents(
  options: ComponentAgentOptions,
  components: Array<RawComponentDefinition & { component_id: string }>,
): Promise<ComponentRunResult[]> {
  const concurrency = Number(process.env.EDS_GENERATE_CONCURRENCY ?? DEFAULT_COMPONENT_CONCURRENCY);
  process.stderr.write(
    `Categorizing ${c.bold(String(components.length))} component${components.length === 1 ? '' : 's'}` +
      c.dim(`  (concurrency: ${concurrency})`) +
      '\n',
  );

  const results: ComponentRunResult[] = new Array(components.length);
  let next = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (next < components.length) {
      const i = next++;
      results[i] = await invokeComponentAgent(options, components[i]!, i, components.length);
      completed += 1;
      process.stderr.write(`${formatGenerateProgressLine(completed, components.length, results[i]!.componentName)}\n`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, components.length) }, worker));
  return results;
}
