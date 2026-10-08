import { DESIGN_TOKEN_TYPES } from '../../../../steps/shared/dtcg/constants/token-types.js';
import type { ValidationDiagnostic } from '../../types/validation.js';

export function walkDTCG(
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
        diagnostics.push({ path: currentPath, message: 'Token has "$value" but missing required "$type"' });
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
