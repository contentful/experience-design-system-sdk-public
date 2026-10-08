import type { ErrorDiagnostic, ParsedEdsiError } from './types.js';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function displayValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isPathSegment(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

export function formatPath(value: unknown): { path?: string | null } {
  if (isPathSegment(value)) return String(value) ? { path: String(value) } : { path: null };
  if (Array.isArray(value)) {
    const parts = value.filter(isPathSegment);
    return parts.length > 0 ? { path: parts.join(' › ') } : { path: null };
  }
  return {};
}

export function componentFromPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const manifestMatch = path.match(/manifest:components\/([^/›]+)/);
  if (manifestMatch?.[1]) return manifestMatch[1];
  const parts = path
    .split(/[›/]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const componentsIndex = parts.findIndex((part) => part === 'components');
  return componentsIndex === -1 ? undefined : parts[componentsIndex + 1];
}

export function diagnosticMessage(error: Record<string, unknown>): Pick<ErrorDiagnostic, 'message' | 'messageSource'> {
  const candidates: Array<[ErrorDiagnostic['messageSource'], unknown]> = [
    ['message', error.message],
    ['details', error.details],
    ['error', error.error],
    ['name', error.name],
  ];
  for (const [messageSource, value] of candidates) {
    const message = displayValue(value);
    if (message !== null) return { message, messageSource };
  }
  return { message: 'Validation failed' };
}

export function parseObjectLiteralTail(body: string): Pick<ParsedEdsiError, 'code' | 'cycle'> | null {
  const braceStart = body.lastIndexOf('{');
  if (braceStart === -1) return null;
  const tail = body.slice(braceStart);
  const codeMatch = tail.match(/code:\s*['"]([^'"]+)['"]/);
  const cycleMatch = tail.match(/cycle:\s*\[\s*([^\]]*)\s*\]/);
  if (!codeMatch && !cycleMatch) return null;
  const code = codeMatch ? codeMatch[1] : null;
  let cycle: string[] | null = null;
  if (cycleMatch) {
    cycle = cycleMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0);
    if (cycle.length === 0) cycle = null;
  }
  return { code, cycle };
}
