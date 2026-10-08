import type { ValidationDiagnostic, ValidationResult } from '../../cdf/validators/types-validation.js';
import { readJsonFile } from '../../cdf/validators/read-json-file.js';
import { walkDTCG } from './helpers/walk-dtcg.js';

export async function validateDTCGTokenFile(filePath: string): Promise<ValidationResult> {
  const readResult = await readJsonFile(filePath);
  if (!readResult.ok) return readResult.result;

  const { value: parsed } = readResult;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      valid: false,
      summary: '',
      diagnostics: [
        {
          path: '/',
          message: `Expected object, got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed}`,
        },
      ],
    };
  }

  const diagnostics: ValidationDiagnostic[] = [];
  const counts = { tokens: 0, groups: 0 };
  walkDTCG(parsed as Record<string, unknown>, '', diagnostics, counts);

  if (diagnostics.length > 0) {
    return { valid: false, summary: '', diagnostics };
  }

  return {
    valid: true,
    summary: `Valid DTCG token file — ${counts.tokens} token${counts.tokens === 1 ? '' : 's'} in ${counts.groups} group${counts.groups === 1 ? '' : 's'}`,
    diagnostics: [],
  };
}
