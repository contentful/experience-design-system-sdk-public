import { buildPrompt } from '@contentful/experience-design-system-cli/src/generate/prompt-builder.js';
import { parseSelectToolCallLines } from '@contentful/experience-design-system-cli/src/generate/agent-runner.js';
import { getClient } from '../llm-client.js';
import type { RawComponentDefinition } from '../types.js';

export type Stage1Result = {
  accepted: RawComponentDefinition[];
  rejected: string[];
};

export async function runStage1(rawComponents: RawComponentDefinition[]): Promise<Stage1Result> {
  const accepted: RawComponentDefinition[] = [];
  const rejected: string[] = [];

  await Promise.all(
    rawComponents.map(async (component) => {
      try {
        const prompt = await buildPrompt({
          skill: 'select',
          mode: 'autonomous',
          rawComponentsInline: JSON.stringify([component], null, 2),
          outDir: '/tmp',
        });

        const stdout = await getClient().invoke(prompt, 1024);
        const { calls, warnings } = parseSelectToolCallLines(stdout);

        if (warnings.length > 0) {
          for (const w of warnings) {
            console.debug(`  [stage1] parse warning for ${component.name}: ${w}`);
          }
        }

        const decision = calls.find((c) => c.name === component.name);
        if (decision?.tool === 'select_component') {
          accepted.push(component);
        } else {
          rejected.push(component.name);
        }
      } catch (err) {
        console.warn(
          `  [stage1] component "${component.name}" failed — skipping: ${err instanceof Error ? err.message : String(err)}`,
        );
        rejected.push(component.name);
      }
    }),
  );

  return { accepted, rejected };
}
