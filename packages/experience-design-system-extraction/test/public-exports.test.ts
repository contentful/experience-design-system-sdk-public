import * as extraction from '../src/index.js';
import { describe, expect, it } from 'vitest';

const existingRuntimeExports = [
  'stripScoringFields',
  'extractComponents',
  'extractEndpoint',
  'extractReactComponents',
  'extractVueComponents',
  'extractVueTsxComponents',
  'extractStencilComponents',
  'extractAstroComponents',
  'extractWebComponentDefinitions',
  'extractSvelteComponents',
  'extractAllowedComponentsFromTypeText',
  'extractAllowedComponentsFromJsdoc',
  'isNonAuthorableComponent',
  'computeExtractionScore',
  'deriveNeedsReview',
  'inspectComponentSource',
  'describeReviewReasons',
  'describeReviewReason',
  'isDataWrapperReviewReason',
  'HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON',
  'POSSIBLE_DATA_FETCH_WRAPPER_REASON',
  'ZERO_SURFACE_RENDERED_UI_REASON',
  'validateExtractedComponents',
  'shouldExcludeDueToValidation',
  'formatExclusionWarning',
  'formatExcludedComponentLines',
  'parseImportedNames',
  'CONTENT_NAME_EXCEPTIONS',
  'isReactNodeType',
  'isArrayReactNodeType',
  'shouldBeSlot',
  'preClassifyProp',
  'preClassifyComponent',
] as const;

describe('extraction package root exports', () => {
  it('preserves the existing runtime export surface', () => {
    for (const exportName of existingRuntimeExports) {
      expect(extraction, `missing root export: ${exportName}`).toHaveProperty(exportName);
    }
  });
});
