import os from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawComponentDefinition, RawPropDefinition, ComponentExtractionResult } from '../../types/component.js';
import { runFileExtractionWorkers } from '../shared/helpers/file-processing/file-workers.js';
import { createSortedExtractionResult } from '../shared/helpers/file-processing/result-normalizer.js';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { resolveVueComponentName } from './helpers/resolve-vue-component-name.js';
import { extractSlotsFromVueTemplate, collectRuntimeAccessSlots, mergeVueSlots } from './helpers/extract-vue-slots.js';
import { extractVueSetupProps } from './helpers/extract-vue-setup-props.js';
import { extractVueOptionsProps } from './helpers/extract-vue-options-props.js';
import {
  collectVueSourceCandidates,
  createVueSfcCompilerContexts,
  type VueSfcCompilerContexts,
} from './helpers/collect-vue-source-candidates.js';
import type { ExtractorOptions } from '../../types/options.js';

export async function extractVueComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const vueFiles = filePaths.filter((f) => f.endsWith('.vue'));
  const sourceByPath = new Map<string, string>();
  const compilerInputs = vueFiles.flatMap((filePath) => {
    try {
      const source = readFileSync(filePath, 'utf8');
      sourceByPath.set(resolve(filePath), source);
      const { descriptor } = parseSFC(source);
      const script = descriptor.scriptSetup ?? descriptor.script;
      return [{ filePath, scriptContent: script?.content ?? '' }];
    } catch {
      return [];
    }
  });
  const compilerContexts =
    compilerInputs.length > 0 ? createVueSfcCompilerContexts(compilerInputs, options) : undefined;
  const { items: components, warnings } = await runFileExtractionWorkers(
    vueFiles,
    os.cpus().length,
    async (filePath, source) => {
      const analysisSource = sourceByPath.get(resolve(filePath)) ?? source;
      const { component, warnings: fileWarnings } = await extractFromVueSFC(
        filePath,
        analysisSource,
        options,
        compilerContexts,
      );
      return { item: component, warnings: fileWarnings };
    },
    (filePath, error) =>
      `Failed to extract from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
  );

  return {
    ...createSortedExtractionResult(components, warnings),
    ...(compilerContexts ? { extractionDiagnostics: compilerContexts.diagnostics } : {}),
  };
}

async function extractFromVueSFC(
  filePath: string,
  source: string,
  options: ExtractorOptions,
  compilerContexts?: VueSfcCompilerContexts,
): Promise<{ component: RawComponentDefinition | null; warnings: string[] }> {
  const { descriptor, errors } = parseSFC(source);
  const fileWarnings: string[] = errors.map(
    (e) => `Parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
  );
  const name = resolveVueComponentName(filePath);

  let props: RawPropDefinition[] = [];
  let component: RawComponentDefinition;
  let scriptContent = '';
  let scriptOffset = 0;
  const setupProps = descriptor.scriptSetup
    ? await extractVueSetupProps(filePath, descriptor.scriptSetup.content)
    : null;

  if (setupProps !== null) {
    props = setupProps;
    scriptContent = descriptor.scriptSetup?.content ?? '';
    scriptOffset = descriptor.scriptSetup?.loc.start.offset ?? 0;
    const templateSlots = descriptor.template?.ast ? extractSlotsFromVueTemplate(descriptor.template.ast as never) : [];
    const slots = mergeVueSlots(templateSlots, collectRuntimeAccessSlots(source));
    component = { name, source: filePath, sourcePath: filePath, framework: 'vue', props, slots };
  } else if (descriptor.script) {
    const optionsComponent = await extractOptionsApiComponent(
      filePath,
      descriptor.script.content,
      fileWarnings,
      name,
      descriptor.template?.ast,
      source,
    );
    props = optionsComponent.component?.props ?? [];
    component = optionsComponent.component ?? {
      name,
      source: filePath,
      sourcePath: filePath,
      framework: 'vue',
      props: [],
      slots: [],
    };
    scriptContent = descriptor.script.content;
    scriptOffset = descriptor.script.loc.start.offset;
    fileWarnings.push(...optionsComponent.warnings.filter((warning) => !fileWarnings.includes(warning)));
  } else {
    const templateSlots = descriptor.template?.ast ? extractSlotsFromVueTemplate(descriptor.template.ast as never) : [];
    const slots = mergeVueSlots(templateSlots, collectRuntimeAccessSlots(source));
    component = { name, source: filePath, sourcePath: filePath, framework: 'vue', props, slots };
  }

  const candidateResult = collectVueSourceCandidates(
    filePath,
    source,
    scriptContent,
    scriptOffset,
    props,
    component.slots,
    options,
    compilerContexts
      ? { project: compilerContexts.projectBySfcPath.get(resolve(filePath)), diagnostics: compilerContexts.diagnostics }
      : undefined,
  );
  const candidateFields = {
    sourceCandidates: candidateResult.sourceCandidates,
    factSchemaVersion: candidateResult.factSchemaVersion,
  };

  return {
    component: { ...component, ...candidateFields },
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
    component: {
      name,
      source: filePath,
      sourcePath: filePath,
      framework: 'vue',
      props,
      slots,
    },
    warnings: fileWarnings,
  };
}
