import { Ajv, type ErrorObject } from 'ajv';
import { cdfV1JsonSchema, CDF_V1_SCHEMA_URL } from './schema.js';
import type {
  CDFFile,
  CDFComponentEntry,
  CDFValidationError,
  CDFValidationWarning,
  CDFValidationResult,
} from './types.js';

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

function validatePropertyTokenConstraints(
  path: string,
  prop: Record<string, unknown>,
  errors: CDFValidationError[],
  warnings: CDFValidationWarning[],
): void {
  const sets = prop['$token.sets'] as string[] | undefined;
  const allowed = prop['$token.allowed'] as string[] | undefined;
  if (sets === undefined && allowed === undefined) return;

  const isTokenDesignProperty = prop['$type'] === 'token' && prop['$category'] === 'design';
  if (!isTokenDesignProperty) {
    if (sets !== undefined) {
      errors.push({
        path: `${path}/$token.sets`,
        message: '"$token.sets" is only allowed on properties with $type "token" and $category "design"',
      });
    }
    if (allowed !== undefined) {
      errors.push({
        path: `${path}/$token.allowed`,
        message: '"$token.allowed" is only allowed on properties with $type "token" and $category "design"',
      });
    }
    return;
  }

  if (allowed !== undefined) {
    const effectiveSets = sets ?? [];
    const offending = allowed.filter((tokenPath) => !effectiveSets.includes(tokenPath));
    if (offending.length > 0) {
      errors.push({
        path: `${path}/$token.allowed`,
        message: `"$token.allowed" must be a subset of "$token.sets"; not found in $token.sets: ${offending.join(', ')}`,
      });
    }
  }

  const values = prop['$values'] as string[] | undefined;
  if (allowed !== undefined && allowed.length > 0 && values !== undefined) {
    const sameContents = allowed.length === values.length && allowed.every((v) => values.includes(v));
    if (!sameContents) {
      warnings.push({
        path: `${path}/$token.allowed`,
        message: '"$values" and "$token.allowed" have differing contents; "$token.allowed" is authoritative',
      });
    }
  }
}

function validateTokenConstraints(components: Array<{ key: string; entry: CDFComponentEntry }>): {
  errors: CDFValidationError[];
  warnings: CDFValidationWarning[];
} {
  const errors: CDFValidationError[] = [];
  const warnings: CDFValidationWarning[] = [];

  for (const { key, entry } of components) {
    const componentPath = `/${key.replace(/\./g, '/')}`;
    for (const [propKey, prop] of Object.entries(entry.$properties ?? {})) {
      validatePropertyTokenConstraints(
        `${componentPath}/$properties/${propKey}`,
        prop as Record<string, unknown>,
        errors,
        warnings,
      );
    }
  }

  return { errors, warnings };
}

export function validateCDF(input: unknown): CDFValidationResult {
  const valid = validate(input);
  if (!valid) {
    const errors: CDFValidationError[] = (validate.errors ?? []).map((err: ErrorObject) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      expected: err.params ? JSON.stringify(err.params) : undefined,
    }));
    return { valid: false, errors, warnings: [], components: [] };
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
      warnings: [],
      components: [],
    };
  }

  const components = parseCDFComponents(file as Record<string, unknown>);
  const { errors, warnings } = validateTokenConstraints(components);
  return { valid: errors.length === 0, errors, warnings, components };
}
