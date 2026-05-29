import type { CDFPropertyType, CDFPropertyCategory } from './vocabularies.js';

export interface CDFPropertyDefinition {
  $type: CDFPropertyType;
  $category: CDFPropertyCategory;
  $description?: string;
  $required?: boolean;
  $default?: unknown;
  $values?: string[];
  '$token.kind'?: string;
}

export interface CDFSlotDefinition {
  $description?: string;
  $allowedComponents?: string[];
  $required?: boolean;
}

export interface CDFComponentEntry {
  $type: 'component';
  $description?: string;
  $properties: Record<string, CDFPropertyDefinition>;
  $slots?: Record<string, CDFSlotDefinition>;
}

export type CDFGroupOrComponent = CDFComponentEntry | CDFGroup;

export interface CDFGroup {
  $description?: string;
  [key: string]: CDFGroupOrComponent | string | undefined;
}

export interface CDFFile {
  $schema: string;
  [key: string]: CDFGroupOrComponent | string | undefined;
}

export interface CDFValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface CDFValidationResult {
  valid: boolean;
  errors: CDFValidationError[];
  components: Array<{ key: string; entry: CDFComponentEntry }>;
}
