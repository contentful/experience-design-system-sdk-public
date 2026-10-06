import { formatGenerateProgressLine } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '../../types.js';
import { c } from '../../output/format.js';
import { runOneComponent } from './run-one-component.js';
import type { ComponentRunOptions, ComponentRunResult } from './run-one-component.js';

export type { ComponentRunOptions, ComponentRunResult };

const DEFAULT_COMPONENT_CONCURRENCY = 10;

export async function runAllComponents(
  options: ComponentRunOptions,
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
      results[i] = await runOneComponent(options, components[i]!, i, components.length);
      completed += 1;
      process.stderr.write(`${formatGenerateProgressLine(completed, components.length, results[i]!.componentName)}\n`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, components.length) }, worker));
  return results;
}
