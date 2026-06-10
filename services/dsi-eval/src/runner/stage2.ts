import { buildPrompt } from '@contentful/experience-design-system-cli/src/generate/prompt-builder.js';
import { parseToolCallLines } from '@contentful/experience-design-system-cli/src/generate/agent-runner.js';
import { CDF_V1_SCHEMA_URL } from '@contentful/experience-design-system-types/src/cdf/schema.js';
import { getClient } from '../llm-client.js';
import type { RawComponentDefinition, CDFFile, CDFComponentEntry, CDFPropertyDefinition } from '../types.js';
import type { CDFSlotDefinition } from '@contentful/experience-design-system-types/src/cdf/types.js';

export async function runStage2(selectedComponents: RawComponentDefinition[]): Promise<CDFFile> {
  const cdf: CDFFile = { $schema: CDF_V1_SCHEMA_URL };

  await Promise.all(
    selectedComponents.map(async (component) => {
      const prompt = await buildPrompt({
        skill: 'components',
        mode: 'autonomous',
        rawComponentsInline: JSON.stringify([component], null, 2),
        outDir: '/tmp',
      });

      const stdout = await getClient().invoke(prompt);
      const { calls } = parseToolCallLines(stdout);

      const entry: CDFComponentEntry = {
        $type: 'component',
        $properties: {},
      };

      for (const call of calls) {
        if (call.tool === 'classify_component') {
          if (call.description) entry.$description = call.description;
        } else if (call.tool === 'classify_prop') {
          const prop: CDFPropertyDefinition = {
            $type: call.cdf_type as CDFPropertyDefinition['$type'],
            $category: call.cdf_category,
          };
          if (call.description) prop.$description = call.description;
          if (call.required !== undefined) prop.$required = call.required;
          if (call.values?.length) prop.$values = call.values;
          if (call.token_kind) prop['$token.kind'] = call.token_kind;
          if (call.default !== undefined) prop.$default = call.default;
          entry.$properties[call.prop] = prop;
        } else if (call.tool === 'classify_slot') {
          if (!entry.$slots) entry.$slots = {};
          const slot: CDFSlotDefinition = {};
          if (call.required !== undefined) slot.$required = call.required;
          if (call.allowed_components?.length) slot.$allowedComponents = call.allowed_components;
          if (call.description) slot.$description = call.description;
          entry.$slots[call.slot] = slot;
        }
      }

      cdf[component.name] = entry;
    }),
  );

  return cdf;
}
