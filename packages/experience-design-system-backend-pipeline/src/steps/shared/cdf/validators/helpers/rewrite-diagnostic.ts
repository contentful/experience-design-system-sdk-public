import type { ValidationDiagnostic } from '../types-validation.js';
import { extractValue } from './extract-value.js';
import { inferParamsShape } from './infer-params-shape.js';

export function rewriteDiagnostic(
  error: { path: string; message: string; expected?: string; actual?: string },
  input: unknown,
): ValidationDiagnostic {
  const params = inferParamsShape(error.expected);

  if (!params) return { ...error };

  let { path } = error;
  let message = error.message;
  let expected = error.expected;
  let actual = error.actual;

  if ('missingProperty' in params) {
    const prop = params.missingProperty as string;
    path = `${path}/${prop}`;
    message = `Missing required property "${prop}"`;
    expected = undefined;
    actual = undefined;
  } else if ('allowedValues' in params) {
    const values = params.allowedValues as string[];
    const fieldName = path.split('/').pop() ?? path;
    message = `Invalid ${fieldName.replace(/^\$/, '')}`;
    expected = values.join(', ');
    actual = extractValue(input, path);
  } else if ('allowedValue' in params) {
    message = 'Invalid value';
    expected = String(params.allowedValue);
    actual = extractValue(input, path);
  } else {
    expected = JSON.stringify(params);
  }

  return {
    path,
    message,
    ...(expected !== undefined && { expected }),
    ...(actual !== undefined && { actual }),
  };
}
