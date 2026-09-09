import { readFile } from 'node:fs/promises';
import { validateCDF } from '@contentful/experience-design-system-types';
import type { ValidationDiagnostic, ValidationResult } from './format-errors.js';

function extractValue(input: unknown, path: string): string | undefined {
  if (path === '/') return undefined;
  const parts = path.split('/').filter(Boolean);
  let current: unknown = input;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) return undefined;
  return typeof current === 'string' ? current : JSON.stringify(current);
}

function inferParamsShape(expected?: string): Record<string, unknown> | null {
  if (!expected) return null;
  try {
    return JSON.parse(expected) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rewriteDiagnostic(
  error: { path: string; message: string; expected?: string; actual?: string },
  input: unknown,
): ValidationDiagnostic {
  const params = inferParamsShape(error.expected);

  if (!params) {
    return { ...error };
  }

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

export async function validateCDFFile(filePath: string): Promise<ValidationResult> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    return {
      valid: false,
      summary: '',
      diagnostics: [{ path: filePath, message: (err as Error).message }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      valid: false,
      summary: '',
      diagnostics: [{ path: filePath, message: `Invalid JSON: ${(err as Error).message}` }],
    };
  }

  const cdfResult = validateCDF(parsed);

  if (!cdfResult.valid) {
    const diagnostics = cdfResult.errors
      .filter((e) => {
        const params = inferParamsShape(e.expected);
        return !params || !('passingSchemas' in params);
      })
      .map((e) => rewriteDiagnostic(e, parsed));
    return { valid: false, summary: '', diagnostics };
  }

  const count = cdfResult.components.length;
  return {
    valid: true,
    summary: `Valid CDF v1 — ${count} component${count === 1 ? '' : 's'} found`,
    diagnostics: [],
  };
}
