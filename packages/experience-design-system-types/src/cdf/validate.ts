import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { cdfJsonSchema, CDF_SCHEMA_URL } from './schema.js';
import { DESIGN_TOKEN_TYPES } from '../dtcg/token-types.js';
import type { CDFFile, CDFComponentEntry, CDFTokenEntry, CDFValidationError, CDFValidationResult } from './types.js';

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(cdfJsonSchema);

const TOKEN_TYPE_SET = new Set<string>(DESIGN_TOKEN_TYPES);

function isComponentEntry(value: unknown): value is CDFComponentEntry {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['$type'] === 'component';
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
): {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens: Array<{ path: string; entry: CDFTokenEntry }>;
} {
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

function entryValidator(name: 'component' | 'token'): ValidateFunction {
  const check = ajv.getSchema(`${CDF_SCHEMA_URL}#/definitions/${name}`);
  if (!check) throw new Error(`the CDF schema has no "${name}" definition`);
  return check;
}

const validateComponentEntry = entryValidator('component');
const validateTokenEntry = entryValidator('token');

// A failed if/then rule adds a second, vaguer error; the first one already says what is wrong.
function toValidationErrors(errors: ErrorObject[] | null | undefined, prefix = ''): CDFValidationError[] {
  return (errors ?? [])
    .filter((err) => err.keyword !== 'if')
    .map((err) => ({
      path: `${prefix}${err.instancePath}` || '/',
      message: err.message ?? 'Unknown validation error',
      expected: err.params ? JSON.stringify(err.params) : undefined,
    }));
}

/**
 * The schema's top level is a `oneOf` of component, token and group, and Ajv reports a failed `oneOf` by listing the errors
 * of every branch, which buries the real one under errors from branches that never applied. This validates each entry
 * against the one definition its `$type` names instead, so the errors are about the entry that is wrong.
 */
function entryErrors(node: Record<string, unknown>, prefix: string): CDFValidationError[] {
  const errors: CDFValidationError[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$') || typeof value !== 'object' || value === null) continue;
    const path = `${prefix}/${key}`;
    const type = (value as Record<string, unknown>)['$type'];
    const check =
      type === 'component'
        ? validateComponentEntry
        : TOKEN_TYPE_SET.has(type as string)
          ? validateTokenEntry
          : undefined;
    if (!check) {
      errors.push(...entryErrors(value as Record<string, unknown>, path));
    } else if (!check(value)) {
      errors.push(...toValidationErrors(check.errors, path));
    }
  }
  return errors;
}

export function validateCDF(input: unknown): CDFValidationResult {
  const valid = validate(input);
  if (!valid) {
    const focused =
      typeof input === 'object' && input !== null ? entryErrors(input as Record<string, unknown>, '') : [];
    const errors = focused.length > 0 ? focused : toValidationErrors(validate.errors);
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
