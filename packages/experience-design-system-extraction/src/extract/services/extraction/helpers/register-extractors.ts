import type { ComponentExtractor } from '../../../types/component-extractor.js';
import { extractAstroComponents } from '../../../framework-adapters/astro/extractor.js';
import { extractReactComponents } from '../../../framework-adapters/react/extractor.js';
import { extractStencilComponents } from '../../../framework-adapters/stencil/extractor.js';
import { extractSvelteComponents } from '../../../framework-adapters/svelte/extractor.js';
import { extractVueTsxComponents } from '../../../framework-adapters/vue-tsx/extractor.js';
import { extractVueComponents } from '../../../framework-adapters/vue/extractor.js';
import { extractWebComponentDefinitions } from '../../../framework-adapters/web-components/extractor.js';

export interface ExtractorFileGroup {
  extractor: ComponentExtractor;
  filePaths: string[];
}

/** Ordered adapter registration; overlapping filters intentionally allow a file to be inspected by multiple adapters. */
export const extractorRegistry: readonly ComponentExtractor[] = [
  {
    name: 'stencil',
    fileFilter: (filePath) => /\.[jt]sx$/.test(filePath),
    extract: extractStencilComponents,
  },
  {
    name: 'react',
    fileFilter: (filePath) => /\.[jt]sx?$/.test(filePath) && !filePath.endsWith('.d.ts'),
    extract: extractReactComponents,
  },
  {
    name: 'vue-tsx',
    fileFilter: (filePath) => /\.[jt]sx?$/.test(filePath) && !filePath.endsWith('.d.ts'),
    extract: extractVueTsxComponents,
  },
  {
    name: 'vue',
    fileFilter: (filePath) => filePath.endsWith('.vue'),
    extract: extractVueComponents,
  },
  {
    name: 'astro',
    fileFilter: (filePath) => filePath.endsWith('.astro'),
    extract: extractAstroComponents,
  },
  {
    name: 'web-components',
    fileFilter: (filePath) => /\.[jt]s$/.test(filePath) && !/\.[jt]sx$/.test(filePath) && !filePath.endsWith('.d.ts'),
    extract: extractWebComponentDefinitions,
  },
  {
    name: 'svelte',
    fileFilter: (filePath) => {
      if (!filePath.endsWith('.svelte')) return false;
      const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
      if (/^\+(page|layout|error)\.svelte$/.test(filename)) return false;
      return true;
    },
    extract: extractSvelteComponents,
  },
];

export function routeFilesToExtractors(
  filePaths: readonly string[],
  extractors: readonly ComponentExtractor[] = extractorRegistry,
): ExtractorFileGroup[] {
  const filesByExtractor = new Map<ComponentExtractor, string[]>();

  for (const extractor of extractors) {
    filesByExtractor.set(extractor, []);
  }

  for (const filePath of filePaths) {
    for (const extractor of extractors) {
      if (extractor.fileFilter(filePath)) {
        filesByExtractor.get(extractor)?.push(filePath);
      }
    }
  }

  return extractors
    .map((extractor) => ({ extractor, filePaths: filesByExtractor.get(extractor) ?? [] }))
    .filter(({ filePaths: groupedFilePaths }) => groupedFilePaths.length > 0);
}
