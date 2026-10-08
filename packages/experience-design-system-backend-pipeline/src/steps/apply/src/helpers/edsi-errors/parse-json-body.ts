import { asRecord, componentFromPath, diagnosticMessage, displayValue, formatPath } from './helpers.js';
import type { ErrorDiagnostic, ParsedEdsiError } from './types.js';

function parseValidationDiagnostics(details: Record<string, unknown>): ErrorDiagnostic[] {
  if (!Array.isArray(details.errors)) return [];
  const diagnostics: ErrorDiagnostic[] = [];
  for (const rawError of details.errors) {
    const error = asRecord(rawError);
    if (!error) continue;
    const location = formatPath(error.path);
    const component =
      displayValue(error.component ?? error.componentName ?? error.componentId) ?? componentFromPath(location.path);
    diagnostics.push({ ...diagnosticMessage(error), ...location, ...(component ? { component } : {}) });
  }
  return diagnostics;
}

export function parseJsonBody(body: string): Partial<ParsedEdsiError> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const p = asRecord(parsed);
  if (!p) return null;
  const details = asRecord(p.details) ?? {};
  const pick = (k: string): unknown => (p[k] !== undefined ? p[k] : details[k]);
  const codeRaw = pick('code') ?? asRecord(p.sys)?.id;
  const messageRaw = pick('message');
  const cycleRaw = pick('cycle');
  const out: Partial<ParsedEdsiError> = {};
  if (typeof codeRaw === 'string') out.code = codeRaw;
  if (typeof messageRaw === 'string') out.message = messageRaw;
  if (Array.isArray(cycleRaw)) {
    const strs = cycleRaw.filter((x): x is string => typeof x === 'string');
    if (strs.length > 0) out.cycle = strs;
  }
  const diagnostics = parseValidationDiagnostics(details);
  if (diagnostics.length > 0) out.diagnostics = diagnostics;
  return out;
}
