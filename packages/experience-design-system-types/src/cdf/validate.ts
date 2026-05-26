import { Ajv, type ErrorObject } from 'ajv';
import { cdfV1JsonSchema, CDF_V1_SCHEMA_URL } from './schema.js';
import type { CDFFile, CDFComponentEntry, CDFValidationError, CDFValidationResult } from './types.js';

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(cdfV1JsonSchema);

function isComponentEntry(value: unknown): value is CDFComponentEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$type' in value &&
    (value as Record<string, unknown>)['$type'] === 'component'
  );
}

export function parseCDFComponents(
  obj: Record<string, unknown>,
  prefix: string = '',
): Array<{ key: string; entry: CDFComponentEntry }> {
  const results: Array<{ key: string; entry: CDFComponentEntry }> = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    if (isComponentEntry(value)) {
      results.push({ key: prefix ? `${prefix}.${key}` : key, entry: value });
    } else if (typeof value === 'object' && value !== null) {
      results.push(...parseCDFComponents(value as Record<string, unknown>, prefix ? `${prefix}.${key}` : key));
    }
  }
  return results;
}

export function validateCDF(input: unknown): CDFValidationResult {
  const valid = validate(input);
  if (!valid) {
    const errors: CDFValidationError[] = (validate.errors ?? []).map((err: ErrorObject) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      expected: err.params ? JSON.stringify(err.params) : undefined,
    }));
    return { valid: false, errors, components: [] };
  }

  const file = input as CDFFile;
  if (file.$schema !== CDF_V1_SCHEMA_URL) {
    return {
      valid: false,
      errors: [
        {
          path: '/$schema',
          message: `Expected schema "${CDF_V1_SCHEMA_URL}"`,
          expected: CDF_V1_SCHEMA_URL,
          actual: file.$schema,
        },
      ],
      components: [],
    };
  }

  const components = parseCDFComponents(file as Record<string, unknown>);
  return { valid: true, errors: [], components };
}
