import { describe, expect, it } from 'vitest';
import { stripScoringFields } from '../../src/extract/types/display.js';
import type { ComponentExtractionResult, RawComponentDefinition } from '../../src/extract/types/component.js';
import type { ExtractionEndpointRequest, ExtractionEndpointResponse } from '../../src/extract/types/contract.js';
import type { ExtractorOptions } from '../../src/extract/types/options.js';
import type { ComponentExtractor } from '../../src/extract/types/component-extractor.js';

describe('extraction model and port boundaries', () => {
  it('keeps the component model serialization helper independent from scoring policy', () => {
    const component: RawComponentDefinition = {
      name: 'Button',
      source: '/project/Button.tsx',
      framework: 'react',
      props: [],
      slots: [],
      extractionConfidence: 4,
      reviewReasons: ['opaque-type:props'],
      needsReview: false,
    };

    expect(stripScoringFields(component)).toEqual({
      name: 'Button',
      source: '/project/Button.tsx',
      framework: 'react',
      props: [],
      slots: [],
    });
  });

  it('exposes typed endpoint contracts and an extractor port over the model', async () => {
    const request: ExtractionEndpointRequest = {
      filePaths: ['/project/Button.tsx'],
      projectRoot: '/project',
    };
    const options: ExtractorOptions = {
      resolveUnreachable: 'auto',
      projectRoot: '/project',
    };
    const response: ExtractionEndpointResponse = {
      components: [],
      warnings: [],
    };
    const extractor: ComponentExtractor = {
      name: 'test',
      fileFilter: () => true,
      extract: async (_filePaths, _onProgress, receivedOptions): Promise<ComponentExtractionResult> => {
        expect(receivedOptions).toEqual(options);
        return response;
      },
    };

    expect(request.filePaths).toEqual(['/project/Button.tsx']);
    await expect(extractor.extract([...request.filePaths], undefined, options)).resolves.toEqual(response);
  });
});
