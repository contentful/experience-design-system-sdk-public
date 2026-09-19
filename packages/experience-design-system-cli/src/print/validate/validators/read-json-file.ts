import { readFile } from 'node:fs/promises';
import type { ValidationResult } from './format-errors.js';

type ReadJsonFileResult = { ok: true; value: unknown } | { ok: false; result: ValidationResult };

export async function readJsonFile(filePath: string): Promise<ReadJsonFileResult> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      result: {
        valid: false,
        summary: '',
        diagnostics: [{ path: filePath, message: (err as Error).message }],
      },
    };
  }

  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (err) {
    return {
      ok: false,
      result: {
        valid: false,
        summary: '',
        diagnostics: [{ path: filePath, message: `Invalid JSON: ${(err as Error).message}` }],
      },
    };
  }
}
