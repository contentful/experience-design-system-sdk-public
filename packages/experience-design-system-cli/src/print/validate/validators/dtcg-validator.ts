import { readFile } from 'node:fs/promises';
import { DESIGN_TOKEN_TYPES } from '@contentful/experience-design-system-types';
import type { ValidationDiagnostic, ValidationResult } from './format-errors.js';

/*
 * Strict DTCG subset validation.
 *
 * This validator is intentionally stricter than both the W3C DTCG spec and the
 * TypeScript types in @contentful/experience-design-system-types:
 *
 * - No group-level type inheritance. The DTCG spec allows $type on a group to
 *   be inherited by descendants. This validator requires explicit $type on
 *   every leaf token.
 *
 * - No string values at non-$ keys. DTCGTokenGroupNode allows string | undefined
 *   at arbitrary keys, but this validator rejects non-object values at non-$
 *   positions.
 *
 * Both restrictions exist because agent-generated files should be maximally
 * explicit and self-describing.
 */

function walkDTCG(
  obj: Record<string, unknown>,
  path: string,
  diagnostics: ValidationDiagnostic[],
  counts: { tokens: number; groups: number },
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;

    const currentPath = `${path}/${key}`;

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      diagnostics.push({
        path: currentPath,
        message: `Expected object, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`,
      });
      continue;
    }

    const node = value as Record<string, unknown>;
    const hasValue = '$value' in node;
    const hasType = '$type' in node;

    if (hasValue) {
      counts.tokens++;
      if (!hasType) {
        diagnostics.push({
          path: currentPath,
          message: 'Token has "$value" but missing required "$type"',
        });
      } else if (typeof node.$type !== 'string' || !(DESIGN_TOKEN_TYPES as readonly string[]).includes(node.$type)) {
        diagnostics.push({
          path: `${currentPath}/$type`,
          message: 'Invalid design token type',
          expected: DESIGN_TOKEN_TYPES.join(', '),
          actual: String(node.$type),
        });
      }
    } else if (hasType) {
      diagnostics.push({
        path: currentPath,
        message: 'Node has "$type" but missing required "$value" (leaf tokens must have both)',
      });
    } else {
      counts.groups++;
      walkDTCG(node, currentPath, diagnostics, counts);
    }
  }
}

export async function validateDTCGTokenFile(filePath: string): Promise<ValidationResult> {
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
