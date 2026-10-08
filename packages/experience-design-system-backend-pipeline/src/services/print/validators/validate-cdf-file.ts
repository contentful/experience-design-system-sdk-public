import { validateCDF } from '../../../steps/shared/cdf/helpers/validate.js';
import type { ValidationResult } from '../types/validation.js';
import { inferParamsShape } from './helpers/infer-params-shape.js';
import { readJsonFile } from './read-json-file.js';
import { rewriteDiagnostic } from './helpers/rewrite-diagnostic.js';

export async function validateCDFFile(filePath: string): Promise<ValidationResult> {
  const readResult = await readJsonFile(filePath);
  if (!readResult.ok) return readResult.result;

  const { value: parsed } = readResult;
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
