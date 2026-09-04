import { Ajv, type ErrorObject } from 'ajv';
import { cdfV1JsonSchema, CDF_V1_SCHEMA_URL } from './schema.js';
import type { CDFFile, CDFComponentEntry, CDFValidationError, CDFValidationResult } from './types.js';
import { flattenDTCG } from '../dtcg/utils.js';

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

/**
 * Path -> resolved DTCG $type for every leaf token in a token document, used to
 * check that each `$token.allowed` entry names a real token of the property's
 * kind. A leaf whose $type is only declared on an ancestor group flattens to
 * undefined here; such an entry is checked for existence but not for type,
 * rather than reported as a mismatch on incomplete information.
 */
export type TokenTypeIndex = ReadonlyMap<string, string | undefined>;

export function buildTokenTypeIndex(tokenDocument: unknown): TokenTypeIndex {
  const index = new Map<string, string | undefined>();
  if (typeof tokenDocument !== 'object' || tokenDocument === null || Array.isArray(tokenDocument)) {
    return index;
  }
  for (const token of flattenDTCG(tokenDocument as Record<string, unknown>, '')) {
    index.set(token.path, token.$type as string | undefined);
  }
  return index;
}

function validatePropertyTokenConstraints(
  path: string,
  prop: Record<string, unknown>,
  errors: CDFValidationError[],
  tokenTypes: TokenTypeIndex | undefined,
): void {
  const allowed = prop['$token.allowed'] as string[] | undefined;
  const kind = prop['$token.kind'] as string | undefined;
  const values = prop['$values'] as string[] | undefined;
  const isTokenDesignProperty = prop['$type'] === 'token' && prop['$category'] === 'design';

  if (!isTokenDesignProperty) {
    if (allowed !== undefined) {
      errors.push({
        path: `${path}/$token.allowed`,
        message: '"$token.allowed" is only allowed on properties with $type "token" and $category "design"',
      });
    }
    return;
  }

  // A token property's options list is design-token paths; a variant-name list
  // in the same slot would reach the authoring UI as an unmatchable allowlist
  // and silently empty the token picker.
  if (values !== undefined) {
    errors.push({
      path: `${path}/$values`,
      message:
        '"$values" is not valid on a token property; a token property\'s options list is "$token.allowed" (design token paths)',
    });
  }

  if (allowed === undefined) return;

  if (kind === undefined) {
    errors.push({
      path: `${path}/$token.allowed`,
      message: '"$token.allowed" requires "$token.kind" so the token type is resolvable',
    });
  }

  if (allowed.length === 0) {
    errors.push({
      path: `${path}/$token.allowed`,
      message: 'omit "$token.allowed" rather than emitting an empty array; an empty list means unrestricted',
    });
  }

  // Every restriction must name a real token of the property's own kind. There
  // is no serialised universe to diff against — the universe is the token
  // document, so the check needs it supplied. Without one the entries are
  // unverifiable and are left alone rather than assumed wrong.
  if (tokenTypes === undefined || tokenTypes.size === 0) return;

  const missing = allowed.filter((tokenPath) => !tokenTypes.has(tokenPath));
  if (missing.length > 0) {
    errors.push({
      path: `${path}/$token.allowed`,
      message: `"$token.allowed" names tokens absent from the token document: ${missing.join(', ')}`,
    });
  }

  if (kind !== undefined) {
    const mismatched = allowed
      .filter((tokenPath) => tokenTypes.has(tokenPath))
      .map((tokenPath) => ({ tokenPath, type: tokenTypes.get(tokenPath) }))
      .filter((entry) => entry.type !== undefined && entry.type !== kind);
    if (mismatched.length > 0) {
      errors.push({
        path: `${path}/$token.allowed`,
        message: `"$token.allowed" names tokens whose $type is not "${kind}": ${mismatched
          .map((entry) => `${entry.tokenPath} (${entry.type})`)
          .join(', ')}`,
      });
    }
  }
}

function validateTokenConstraints(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
  tokenTypes: TokenTypeIndex | undefined,
): {
  errors: CDFValidationError[];
} {
  const errors: CDFValidationError[] = [];

  for (const { key, entry } of components) {
    const componentPath = `/${key.replace(/\./g, '/')}`;
    for (const [propKey, prop] of Object.entries(entry.$properties ?? {})) {
      validatePropertyTokenConstraints(
        `${componentPath}/$properties/${propKey}`,
        prop as Record<string, unknown>,
        errors,
        tokenTypes,
      );
    }
  }

  return { errors };
}

export interface CDFValidationOptions {
  /**
   * Parsed DTCG token document. When supplied, every `$token.allowed` entry is
   * checked to name a real token in it whose `$type` matches the property's
   * `$token.kind`. Omitted, those entries are accepted unverified — the CDF
   * alone cannot know which tokens exist.
   */
  tokens?: unknown;
}

export function validateCDF(input: unknown, options: CDFValidationOptions = {}): CDFValidationResult {
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
  const tokenTypes = options.tokens !== undefined ? buildTokenTypeIndex(options.tokens) : undefined;
  const { errors } = validateTokenConstraints(components, tokenTypes);
  return { valid: errors.length === 0, errors, components };
}
