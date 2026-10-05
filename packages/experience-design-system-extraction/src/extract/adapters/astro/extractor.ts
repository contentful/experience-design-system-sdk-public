import os from 'node:os';
import { basename } from 'node:path';
import type { RawComponentDefinition, ComponentExtractionResult } from '../../model/component.js';
import { runFileExtractionWorkers } from '../support/file-processing/file-workers.js';
import { createSortedExtractionResult } from '../support/file-processing/result-normalizer.js';
import {
  extractFallbackPropsFromFrontmatter,
  extractPropsFromFrontmatter,
  extractDefaultsFromFrontmatter,
  mergeProps,
} from './frontmatter.js';
import { extractSlotsFromTemplate, extractSlotsFromFrontmatter, mergeSlots } from './slots.js';

function extractFromAstroFile(filePath: string, source: string): RawComponentDefinition {
  const name = basename(filePath, '.astro');

  // Split on `---` fences: frontmatter is between first and second `---`.
  // If there is no `---`, the entire file is a template-only component.
  const fenceIndex = source.startsWith('---') ? 0 : -1;
  let frontmatter = '';
  let template = source;

  if (fenceIndex !== -1) {
    const endFenceIndex = source.indexOf('---', fenceIndex + 3);
    if (endFenceIndex !== -1) {
      frontmatter = source.slice(fenceIndex + 3, endFenceIndex);
      template = source.slice(endFenceIndex + 3);
    }
  }

  const props = frontmatter
    ? mergeProps(extractFallbackPropsFromFrontmatter(frontmatter), extractPropsFromFrontmatter(frontmatter))
    : [];
  const defaults = frontmatter ? extractDefaultsFromFrontmatter(frontmatter) : new Map<string, string>();
  const propsWithDefaults = props.map((p) => {
    const defaultValue = defaults.get(p.name);
    return defaultValue ? { ...p, defaultValue } : p;
  });

  const slots = mergeSlots(extractSlotsFromTemplate(template), extractSlotsFromFrontmatter(frontmatter));

  return { name, source: filePath, sourcePath: filePath, framework: 'astro', props: propsWithDefaults, slots };
}

export async function extractAstroComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
): Promise<ComponentExtractionResult> {
  const astroFiles = filePaths.filter((f) => f.endsWith('.astro'));
  const { items: components, warnings } = await runFileExtractionWorkers(
    astroFiles,
    os.cpus().length,
    async (filePath, source) => ({ item: extractFromAstroFile(filePath, source) }),
    (filePath, error) =>
      `Failed to extract from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
  );
  return createSortedExtractionResult(components, warnings);
}
