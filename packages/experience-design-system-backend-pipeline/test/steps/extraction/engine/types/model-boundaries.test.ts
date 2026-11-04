import { describe, expect, it } from 'vitest';
import type { ComponentExtractionResult } from '../../../../../src/steps/extraction/src/types/component.js';
import type {
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from '../../../../../src/steps/extraction/src/types/contract.js';
import type { ExtractorOptions } from '../../../../../src/steps/extraction/src/types/options.js';
import type { ComponentExtractor } from '../../../../../src/steps/extraction/src/types/component-extractor.js';

describe('extraction model and port boundaries', () => {
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
