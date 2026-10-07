import { DESIGN_TOKEN_TYPES, type DesignTokenType } from './token-types.js';
import { flattenDTCG } from './utils.js';

export interface DTCGValidationError {
  path: string;
  message: string;
  actual?: unknown;
}

export interface DTCGValidationResult {
  valid: boolean;
  errors: DTCGValidationError[];
}

const TOKEN_TYPE_SET = new Set<string>(DESIGN_TOKEN_TYPES);

function isDesignTokenType(value: unknown): value is DesignTokenType {
  return typeof value === 'string' && TOKEN_TYPE_SET.has(value);
}

export function validateDTCG(obj: Record<string, unknown>): DTCGValidationResult {
  const errors: DTCGValidationError[] = [];
  const tokens = flattenDTCG(obj, '');

  for (const token of tokens) {
    if (!isDesignTokenType(token.$type)) {
      errors.push({
        path: token.path,
        message: `Unknown $type "${token.$type}". Must be one of: ${DESIGN_TOKEN_TYPES.join(', ')}.`,
        actual: token.$type,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
