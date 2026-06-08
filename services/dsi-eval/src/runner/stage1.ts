import { buildPrompt } from '@contentful/experience-design-system-cli/src/generate/prompt-builder.js';
import { parseSelectToolCallLines } from '@contentful/experience-design-system-cli/src/generate/agent-runner.js';
import { invokeBedrock } from '../bedrock.js';
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
      const prompt = await buildPrompt({
        skill: 'select',
        mode: 'autonomous',
        rawComponentsInline: JSON.stringify([component], null, 2),
        outDir: '/tmp',
      });

      const stdout = await invokeBedrock(prompt, 1024);
      const { calls } = parseSelectToolCallLines(stdout);

      const decision = calls.find((c) => c.name === component.name);
      if (decision?.tool === 'select_component') {
        accepted.push(component);
      } else {
        rejected.push(component.name);
      }
    }),
  );

  return { accepted, rejected };
}
