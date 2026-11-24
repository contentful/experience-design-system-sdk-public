import type { ErrorObject } from 'ajv';
import type { CDFValidationError } from './types.js';

export function schemaValidationErrors(errors: ErrorObject[] | null | undefined, prefix = ''): CDFValidationError[] {
  return (errors ?? [])
    .filter((err) => err.keyword !== 'if')
    .map((err) => ({
      path: `${prefix}${err.instancePath}` || '/',
      message: err.message ?? 'Unknown validation error',
      expected: err.params ? JSON.stringify(err.params) : undefined,
    }));
}
