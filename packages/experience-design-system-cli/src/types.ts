import type { DesignTokenType } from '@contentful/experience-design-system-types';

// Re-export all extraction types from the extraction package so existing
// internal imports (`from '../types.js'`) continue to work unchanged.
export type {
  ExtractionValidationIssueCode,
  ExtractionValidationIssue,
  RawPropDefinition,
  RawSlotDefinition,
  RawComponentDefinition,
  ComponentExtractionResult,
  ExtractorProgress,
  ExtractorOptions,
  ComponentExtractor,
} from '@contentful/experience-design-system-extraction';
export { stripScoringFields } from '@contentful/experience-design-system-extraction';

// Token-specific types — not part of the extraction package
export interface RawTokenDefinition {
  name: string;
  value: string;
  source: 'css' | 'tailwind' | 'style-dictionary';
  inferredKind: DesignTokenType | string;
  ambiguous: boolean;
}

export interface TokenExtractor {
  name: string;
  extract(projectRoot: string): Promise<RawTokenDefinition[]>;
}
