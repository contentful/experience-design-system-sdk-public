export interface ParsedEdsiError {
  /** Server-side error code, if we could extract one. */
  code: string | null;
  /** Human-readable message, stripped of log/trace decoration. */
  message: string;
  /** Cycle participants, when `code === 'TopoSortCycleError'`. */
  cycle: string[] | null;
  /** True when the message survived cleaning as-is (no parseable structure). */
  raw: boolean;
  /** Validation details supplied by the API, normalized for terminal output. */
  diagnostics?: ErrorDiagnostic[];
}

export interface ErrorDiagnostic {
  message: string;
  component?: string;
  /**
   * A null path means that the API supplied a location but it contained no
   * usable segments. An undefined path means the API did not provide one.
   */
  path?: string | null;
  /** The API field that supplied the diagnostic message, for verbose output. */
  messageSource?: 'message' | 'details' | 'error' | 'name';
}

export interface ApiErrorLike {
  body?: string;
  message: string;
}

const LAMBDA_LOG_PREFIX_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+[0-9a-f-]+\s+ERROR\s+(?:\[dd\.[^\]]*\]\s*)?/;

const DD_TAG_RE = /\[dd\.(?:trace_id|span_id)=[^\]]*\]\s*/g;

export function stripLambdaLogPrefix(body: string): string {
  let out = body.replace(LAMBDA_LOG_PREFIX_RE, '');
  out = out.replace(DD_TAG_RE, '');
  return out.trim();
}

function parseObjectLiteralTail(body: string): Pick<ParsedEdsiError, 'code' | 'cycle'> | null {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function displayValue(value: unknown): string | null {
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

function formatPath(value: unknown): { path?: string | null } {
  if (isPathSegment(value)) return String(value) ? { path: String(value) } : { path: null };
  if (Array.isArray(value)) {
    const parts = value.filter(isPathSegment);
    return parts.length > 0 ? { path: parts.join(' › ') } : { path: null };
  }
  return {};
}

function componentFromPath(path: string | null | undefined): string | undefined {
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

function diagnosticMessage(error: Record<string, unknown>): Pick<ErrorDiagnostic, 'message' | 'messageSource'> {
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

function parseJsonBody(body: string): Partial<ParsedEdsiError> | null {
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

function parseBindingDiagnostics(body: string): Partial<ParsedEdsiError> | null {
  if (!/binding configurations are invalid|Pointer path does not exist/i.test(body)) return null;

  const locationMatches = [...body.matchAll(/(?:^|\.\s)([A-Za-z0-9_$-]+(?:\s*›\s*[A-Za-z0-9_$-]+){2,})/g)];
  const location = locationMatches.at(-1)?.[1];
  const pointerMessage = body.match(
    /Pointer path does not exist for '\[object Object\]':\s*(.+?)(?=\.\s*Default\s*›|$)/i,
  )?.[1];
  const graphQlMessage = body.match(/return GraphQL validation error:\s*(.+?)(?=\.\s*Default\s*›|$)/i)?.[1];
  const heading = body.match(/^(.*?)(?=\.?\s*Pointer path does not exist|\.?\s*Default\s*›)/i)?.[1]?.trim();
  const diagnostics: ErrorDiagnostic[] = [];
  if (pointerMessage) diagnostics.push({ message: pointerMessage.trim(), ...(location ? { path: location } : {}) });
  if (graphQlMessage) diagnostics.push({ message: graphQlMessage.trim(), ...(location ? { path: location } : {}) });

  return {
    code: 'BindingValidationFailed',
    message: heading || 'One or more binding configurations are invalid.',
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

// ApiError.message shape: `${phasePrefix}\n${body}` where phasePrefix looks
// like `apply failed: 400`, `preview failed: 422`, `poll failed: 500`. We
// only strip the prefix line when the first line matches this shape —
// otherwise a raw body that happens to contain a newline (e.g. a Lambda log
// spill with a multi-line object literal) gets truncated mid-structure.
const API_ERROR_PREFIX_RE = /^(?:apply|preview|poll) failed: \d+$/;

export function parseEdsiError(rawInput: string | undefined | null): ParsedEdsiError {
  if (!rawInput) return { code: null, message: '', cycle: null, raw: true };

  const nlIndex = rawInput.indexOf('\n');
  let body = rawInput;
  let prefix = '';
  if (nlIndex !== -1) {
    const firstLine = rawInput.slice(0, nlIndex);
    if (API_ERROR_PREFIX_RE.test(firstLine)) {
      prefix = firstLine;
      body = rawInput.slice(nlIndex + 1);
    }
  }

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
    return {
      code: literal.code ?? null,
      message: head || cleaned,
      cycle: literal.cycle ?? null,
      raw: false,
    };
  }

  return { code: null, message: cleaned || prefix || rawInput, cycle: null, raw: true };
}

export function formatParsedEdsiError(parsed: ParsedEdsiError, opts: { verbose?: boolean; raw?: string } = {}): string {
  const lines: string[] = [];
  if (parsed.code) {
    lines.push(`[${parsed.code}]`);
  }
  if (parsed.message) {
    lines.push(parsed.message);
  }
  for (const diagnostic of parsed.diagnostics ?? []) {
    const context = [
      diagnostic.component ? `Component: ${diagnostic.component}` : null,
      diagnostic.path ? `Path: ${diagnostic.path}` : null,
    ].filter(Boolean);
    lines.push(`- ${diagnostic.message}${context.length > 0 ? ` (${context.join('; ')})` : ''}`);
    if (diagnostic.path === null) {
      lines.push(
        '  Location: not provided by the server. Review the submitted manifest; no component or field was identified.',
      );
    }
    if (opts.verbose && diagnostic.messageSource) {
      lines.push(`  Message field: ${diagnostic.messageSource}`);
    }
  }
  if (parsed.code === 'BindingValidationFailed') {
    const location = parsed.diagnostics?.find((diagnostic) => diagnostic.path)?.path;
    lines.push(
      location
        ? `Next action: review the binding at ${location} and correct its pointer or GraphQL selection.`
        : 'Next action: review the binding pointer and GraphQL selection.',
    );
  }
  if (parsed.cycle && parsed.cycle.length > 0) {
    lines.push(`Cycle: ${parsed.cycle.join(' → ')} → ${parsed.cycle[0]}`);
    lines.push('Break the cycle by removing at least one $allowedComponents entry.');
  }
  if (opts.verbose && opts.raw) {
    lines.push('');
    lines.push('--- raw ---');
    lines.push(opts.raw);
  }
  return lines.filter(Boolean).join('\n');
}

export function formatEdsiError(raw: unknown, opts: { verbose?: boolean; raw?: string } = {}): string {
  const input = typeof raw === 'string' ? raw : displayValue(raw);
  if (!input) return '';
  return formatParsedEdsiError(parseEdsiError(input), { ...opts, raw: opts.raw ?? input });
}

export function formatApiError(error: ApiErrorLike, verbose = false): string {
  const formatted = formatEdsiError(error.body || error.message, { verbose, raw: error.body }) || error.message;
  const phase = error.message.split('\n', 1)[0];
  return /^(?:apply|preview|poll) failed: \d+$/.test(phase) && formatted !== phase
    ? `${phase}\n${formatted}`
    : formatted;
}
