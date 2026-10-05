import os from 'node:os';
import type { ComponentExtractionResult } from '../../model/component.js';
import type { ExtractorOptions } from '../../model/options.js';
import { runFileExtractionWorkers } from '../support/file-processing/file-workers.js';
import { getSvelteComponentName } from './identity.js';
import {
  maybeRunResolveUnreachableRetry,
  collapseUnresolvedTypeWarnings,
  type RetryContext,
} from './helpers/resolve-svelte-unresolved-retry.js';
import { resolveAllowedComponents } from './helpers/resolve-svelte-allowed-components.js';
import { extractFromSvelteFile } from './helpers/extract-from-svelte-file.js';

export async function extractSvelteComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
  opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const svelteFiles = filePaths.filter((f) => f.endsWith('.svelte'));
  const retryContexts = new Map<string, RetryContext>();
  const { items: components, warnings } = await runFileExtractionWorkers(
    svelteFiles,
    os.cpus().length,
    async (filePath, source) => {
      const { component, warnings: fileWarnings, retryContext } = await extractFromSvelteFile(filePath, source);
      return { item: component, warnings: fileWarnings, metadata: retryContext };
    },
    (filePath, error) =>
      `${getSvelteComponentName(filePath)}: failed to extract from ${filePath} — ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
    (filePath, outcome) => {
      if (outcome.metadata) retryContexts.set(filePath, outcome.metadata);
    },
  );

  const finalWarnings = await maybeRunResolveUnreachableRetry(components, warnings, retryContexts, opts);
  resolveAllowedComponents(components);

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings: collapseUnresolvedTypeWarnings(finalWarnings),
  };
}
