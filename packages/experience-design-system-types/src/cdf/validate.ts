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

/**
 * Checks invariants the schema itself leaves optional (so `validateCDF` stays
 * usable for partial/in-progress entries elsewhere in the pipeline) but that the
 * generation skill promises for every emitted component: a `$description` on
 * the component and on every property, and a non-empty `$values` on every
 * `$type: "enum"` property. `print validate` is the pre-push gate, so it
 * enforces what the skill promises rather than let a silently-degraded
 * component (e.g. one that dropped a tool-call line) pass through as valid.
 */
export function checkCDFComponentInvariants(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): CDFValidationError[] {
  const errors: CDFValidationError[] = [];
  for (const { key, entry } of components) {
    if (!entry.$description) {
      errors.push({
        path: `/${key}/$description`,
        message: `Component "${key}" is missing $description`,
      });
    }
    for (const [propName, prop] of Object.entries(entry.$properties ?? {})) {
      if (!(prop as { $description?: string }).$description) {
        errors.push({
          path: `/${key}/$properties/${propName}/$description`,
          message: `Property "${propName}" on "${key}" is missing $description`,
        });
      }
      if ((prop as { $type?: string }).$type === 'enum') {
        const values = (prop as { $values?: string[] }).$values;
        if (!values || values.length === 0) {
          errors.push({
            path: `/${key}/$properties/${propName}/$values`,
            message: `Property "${propName}" on "${key}" is $type "enum" but has no $values`,
          });
        }
      }
    }
  }
  return errors;
}
