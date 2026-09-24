import { Ajv, type ErrorObject } from 'ajv';
import { cdfJsonSchema, CDF_SCHEMA_URL } from './schema.js';
import { DESIGN_TOKEN_TYPES } from '../dtcg/token-types.js';
import type {
  CDFFile,
  CDFComponentEntry,
  CDFTokenEntry,
  CDFValidationError,
  CDFValidationResult,
} from './types.js';

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(cdfJsonSchema);

const TOKEN_TYPE_SET = new Set<string>(DESIGN_TOKEN_TYPES);

function isComponentEntry(value: unknown): value is CDFComponentEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['$type'] === 'component'
  );
}

function isTokenEntry(value: unknown): value is CDFTokenEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    TOKEN_TYPE_SET.has((value as Record<string, unknown>)['$type'] as string)
  );
}

/**
 * Walks the CDF tree once, splitting every leaf into a component or a
 * token by its `$type` (the two vocabularies — 'component' vs.
 * DESIGN_TOKEN_TYPES — are disjoint by construction). Groups (plain nested
 * objects that are neither) recurse.
 */
export function parseCDFComponents(
  obj: Record<string, unknown>,
  prefix: string = '',
): { components: Array<{ key: string; entry: CDFComponentEntry }>; tokens: Array<{ path: string; entry: CDFTokenEntry }> } {
  const components: Array<{ key: string; entry: CDFComponentEntry }> = [];
  const tokens: Array<{ path: string; entry: CDFTokenEntry }> = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isComponentEntry(value)) {
      components.push({ key: path, entry: value });
    } else if (isTokenEntry(value)) {
      tokens.push({ path, entry: value });
    } else if (typeof value === 'object' && value !== null) {
      const nested = parseCDFComponents(value as Record<string, unknown>, path);
      components.push(...nested.components);
      tokens.push(...nested.tokens);
    }
  }

  return { components, tokens };
}

export function validateCDF(input: unknown): CDFValidationResult {
  const valid = validate(input);
  if (!valid) {
    const errors: CDFValidationError[] = (validate.errors ?? []).map((err: ErrorObject) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      expected: err.params ? JSON.stringify(err.params) : undefined,
    }));
    return { valid: false, errors, components: [], tokens: [] };
  }

  const file = input as CDFFile;
  if (file.$schema !== CDF_SCHEMA_URL) {
    return {
      valid: false,
      errors: [
        {
          path: '/$schema',
          message: `Expected schema "${CDF_SCHEMA_URL}"`,
          expected: CDF_SCHEMA_URL,
          actual: file.$schema,
        },
      ],
      components: [],
      tokens: [],
    };
  }

  const { components, tokens } = parseCDFComponents(file as Record<string, unknown>);
  return { valid: true, errors: [], components, tokens };
}
