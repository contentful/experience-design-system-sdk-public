import os from 'node:os';
import type { RawComponentDefinition, RawPropDefinition, ComponentExtractionResult } from '../../model/component.js';
import { runFileExtractionWorkers } from '../support/file-processing/file-workers.js';
import { createSortedExtractionResult } from '../support/file-processing/result-normalizer.js';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { resolveVueComponentName } from './helpers/resolve-vue-component-name.js';
import {
  extractSlotsFromVueTemplate,
  collectRuntimeAccessSlots,
  mergeVueSlots,
} from './helpers/extract-vue-slots.js';
import { extractVueSetupProps } from './helpers/extract-vue-setup-props.js';
import { extractVueOptionsProps } from './helpers/extract-vue-options-props.js';

export async function extractVueComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
): Promise<ComponentExtractionResult> {
  const vueFiles = filePaths.filter((f) => f.endsWith('.vue'));
  const { items: components, warnings } = await runFileExtractionWorkers(
    vueFiles,
    os.cpus().length,
    async (filePath, source) => {
      const { component, warnings: fileWarnings } = await extractFromVueSFC(filePath, source);
      return { item: component, warnings: fileWarnings };
    },
    (filePath, error) =>
      `Failed to extract from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
  );

  return createSortedExtractionResult(components, warnings);
}

async function extractFromVueSFC(
  filePath: string,
  source: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[] }> {
  const { descriptor, errors } = parseSFC(source);
  const fileWarnings: string[] = errors.map(
    (e) => `Parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
  );
  const name = resolveVueComponentName(filePath);

  let props: RawPropDefinition[] = [];
  const setupProps = descriptor.scriptSetup
    ? await extractVueSetupProps(filePath, descriptor.scriptSetup.content)
    : null;

  if (setupProps !== null) {
    props = setupProps;
  } else if (descriptor.script) {
    return extractOptionsApiComponent(filePath, descriptor.script.content, fileWarnings, name, descriptor.template?.ast, source);
  }

  const templateSlots = descriptor.template?.ast
    ? extractSlotsFromVueTemplate(descriptor.template.ast as never)
    : [];
  const slots = mergeVueSlots(templateSlots, collectRuntimeAccessSlots(source));

  return {
    component: { name, source: filePath, sourcePath: filePath, framework: 'vue', props, slots },
    warnings: fileWarnings,
  };
}

async function extractOptionsApiComponent(
  filePath: string,
  scriptContent: string,
  fileWarnings: string[],
  name: string,
  templateAst?: unknown,
  sfcSource?: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[] }> {
  const props = await extractVueOptionsProps(filePath, scriptContent);
  const templateSlots = templateAst ? extractSlotsFromVueTemplate(templateAst as never) : [];
  const runtimeSlots = sfcSource ? collectRuntimeAccessSlots(sfcSource) : [];
  const slots = mergeVueSlots(templateSlots, runtimeSlots);

  return {
    component: { name, source: filePath, sourcePath: filePath, framework: 'vue', props, slots },
    warnings: fileWarnings,
  };
}
