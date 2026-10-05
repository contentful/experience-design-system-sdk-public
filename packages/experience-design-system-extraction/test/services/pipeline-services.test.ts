import { describe, expect, it, vi } from 'vitest';
import type { ComponentExtractionResult, RawComponentDefinition } from '../../src/extract/types/component.js';
import type { ComponentExtractor } from '../../src/extract/types/component-extractor.js';
import { deduplicateComponents } from '../../src/extract/services/deduplication/deduplicate-components.js';
import { routeFilesToExtractors } from '../../src/extract/services/extraction/helpers/register-extractors.js';
import { runExtractorBatches } from '../../src/extract/services/extraction/helpers/run-extractor-batches.js';

function component(overrides: Partial<RawComponentDefinition>): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/repo/src/components/Button/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

function result(...components: RawComponentDefinition[]): ComponentExtractionResult {
  return { components, warnings: [] };
}

describe('extractor registry', () => {
  it('routes each file to every matching extractor in registry order', () => {
    const react = { name: 'react', fileFilter: (filePath: string) => filePath.endsWith('.tsx') } as ComponentExtractor;
    const styles = {
      name: 'styles',
      fileFilter: (filePath: string) => filePath.endsWith('.css'),
    } as ComponentExtractor;

    const groups = routeFilesToExtractors(['Button.tsx', 'Button.css', 'README.md'], [react, styles]);

    expect(groups).toEqual([
      { extractor: react, filePaths: ['Button.tsx'] },
      { extractor: styles, filePaths: ['Button.css'] },
    ]);
  });
});

describe('extraction runner', () => {
  it('runs non-empty batches concurrently and aggregates deltas into progress', async () => {
    const progress: Array<{ filesProcessed: number; componentsFound: number }> = [];
    const first: ComponentExtractor = {
      name: 'first',
      fileFilter: () => true,
      extract: vi.fn(async (_filePaths, onProgress) => {
        onProgress?.({ filesProcessed: 1, componentsFound: 1 });
        return result(component({ name: 'First' }));
      }),
    };
    const second: ComponentExtractor = {
      name: 'second',
      fileFilter: () => true,
      extract: vi.fn(async (_filePaths, onProgress) => {
        onProgress?.({ filesProcessed: 2, componentsFound: 1 });
        return result(component({ name: 'Second' }));
      }),
    };
    const empty: ComponentExtractor = {
      name: 'empty',
      fileFilter: () => true,
      extract: vi.fn(),
    };

    const results = await runExtractorBatches(
      [
        { extractor: first, filePaths: ['First.tsx'] },
        { extractor: second, filePaths: ['Second.tsx', 'Second.test.tsx'] },
        { extractor: empty, filePaths: [] },
      ],
      (update) => progress.push(update),
    );

    expect(results).toEqual([result(component({ name: 'First' })), result(component({ name: 'Second' })), result()]);
    expect(first.extract).toHaveBeenCalledWith(['First.tsx'], expect.any(Function), undefined);
    expect(second.extract).toHaveBeenCalledWith(['Second.tsx', 'Second.test.tsx'], expect.any(Function), undefined);
    expect(empty.extract).not.toHaveBeenCalled();
    expect(progress).toEqual([
      { filesProcessed: 1, componentsFound: 1 },
      { filesProcessed: 3, componentsFound: 2 },
    ]);
  });
});

describe('component deduplicator', () => {
  it('keeps the preferred index entrypoint and reports duplicate evidence', () => {
    const implementation = component({
      name: 'Dropdown',
      source: '/repo/packages/ui/Dropdown/components/Dropdown.tsx',
    });
    const index = component({ name: 'Dropdown', source: '/repo/packages/ui/Dropdown/index.tsx' });

    const deduplicated = deduplicateComponents([result(implementation), result(index)]);

    expect(deduplicated.components).toEqual([index]);
    expect(deduplicated.warnings).toEqual([
      expect.stringContaining('Duplicate component "Dropdown" found in /repo/packages/ui/Dropdown/index.tsx'),
    ]);
  });

  it('preserves same-name components from separate package scopes and emits a collision warning', () => {
    const modals = component({ source: '/repo/packages/modals/Body.tsx', name: 'Body' });
    const chrome = component({ source: '/repo/packages/chrome/Body.tsx', name: 'Body' });

    const deduplicated = deduplicateComponents([result(modals), result(chrome)]);

    expect(deduplicated.components).toHaveLength(2);
    expect(deduplicated.warnings).toEqual([
      expect.stringContaining('Component name collision "Body" found in /repo/packages/chrome/Body.tsx'),
    ]);
  });
});
