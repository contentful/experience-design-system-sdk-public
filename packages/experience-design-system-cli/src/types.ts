import type { DesignTokenType } from '@contentful/experience-design-system-types';

export interface RawTokenDefinition {
  name: string;
  value: string;
  source: 'css' | 'tailwind' | 'style-dictionary';
  inferredKind: DesignTokenType | string;
  ambiguous: boolean;
}

export interface RawPropDefinition {
  name: string;
  type: string;
  required: boolean;
  category?: 'content' | 'design' | 'state';
  defaultValue?: string;
  allowedValues?: string[];
  description?: string;
  tokenReference?: string;
}

export interface RawSlotDefinition {
  name: string;
  isDefault: boolean;
  description?: string;
  allowedComponents?: string[];
}

export interface RawComponentDefinition {
  name: string;
  source: string;
  framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil';
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
  /**
   * True when the source file declaring this component calls
   * React.createContext / createContext. Used downstream to filter
   * non-authorable context-provider components.
   */
  usesCreateContext?: boolean;
}

export interface ComponentExtractionResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export type ExtractorProgress = {
  filesProcessed: number;
  componentsFound: number;
};

export interface ComponentExtractor {
  name: string;
  fileFilter: (filePath: string) => boolean;
  extract(filePaths: string[], onProgress?: (p: ExtractorProgress) => void): Promise<ComponentExtractionResult>;
}

export interface TokenExtractor {
  name: string;
  extract(projectRoot: string): Promise<RawTokenDefinition[]>;
}
