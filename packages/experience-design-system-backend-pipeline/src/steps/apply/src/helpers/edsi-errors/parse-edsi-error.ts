import { parseBindingDiagnostics } from './parse-binding-diagnostics.js';
import { parseJsonBody } from './parse-json-body.js';
import { parseObjectLiteralTail } from './helpers.js';
import { stripLambdaLogPrefix } from './strip-lambda-log-prefix.js';
import type { ParsedEdsiError } from './types.js';

const API_ERROR_PREFIX_RE = /^(?:apply|preview|poll) failed: \d+$/;

export function parseEdsiError(rawInput: string | undefined | null): ParsedEdsiError {
  if (!rawInput) return { code: null, message: '', cycle: null, raw: true };

  const { body, prefix } = splitPhasePrefix(rawInput);
  const cleaned = stripLambdaLogPrefix(body);

  const json = parseJsonBody(cleaned) ?? parseJsonBody(body);
  const bindingFromJson = typeof json?.message === 'string' ? parseBindingDiagnostics(json.message) : null;
  if (bindingFromJson) {
    return {
      code: bindingFromJson.code ?? json?.code ?? null,
      message: bindingFromJson.message ?? cleaned,
      cycle: null,
      raw: false,
      ...(bindingFromJson.diagnostics ? { diagnostics: bindingFromJson.diagnostics } : {}),
    };
  }
  if (json && (json.code || json.message || json.cycle)) {
    return {
      code: json.code ?? null,
      message: json.message ?? (cleaned || prefix),
      cycle: json.cycle ?? null,
      raw: false,
      ...(json.diagnostics ? { diagnostics: json.diagnostics } : {}),
    };
  }

  const binding = parseBindingDiagnostics(cleaned);
  if (binding) {
    return {
      code: binding.code ?? null,
      message: binding.message ?? cleaned,
      cycle: null,
      raw: false,
      ...(binding.diagnostics ? { diagnostics: binding.diagnostics } : {}),
    };
  }

  const literal = parseObjectLiteralTail(cleaned);
  if (literal && (literal.code || literal.cycle)) {
    const braceStart = cleaned.lastIndexOf('{');
    const head = braceStart === -1 ? cleaned : cleaned.slice(0, braceStart).trim();
    return { code: literal.code ?? null, message: head || cleaned, cycle: literal.cycle ?? null, raw: false };
  }

  return { code: null, message: cleaned || prefix || rawInput, cycle: null, raw: true };
}

function splitPhasePrefix(input: string): { body: string; prefix: string } {
  const nlIndex = input.indexOf('\n');
  if (nlIndex === -1) return { body: input, prefix: '' };
  const firstLine = input.slice(0, nlIndex);
  if (!API_ERROR_PREFIX_RE.test(firstLine)) return { body: input, prefix: '' };
  return { body: input.slice(nlIndex + 1), prefix: firstLine };
}
