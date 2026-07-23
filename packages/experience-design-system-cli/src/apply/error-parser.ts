export interface ParsedEdsiError {
  /** Server-side error code, if we could extract one. */
  code: string | null;
  /** Human-readable message, stripped of log/trace decoration. */
  message: string;
  /** Cycle participants, when `code === 'TopoSortCycleError'`. */
  cycle: string[] | null;
  /** True when the message survived cleaning as-is (no parseable structure). */
  raw: boolean;
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

function parseJsonBody(body: string): Partial<ParsedEdsiError> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const details = (p.details && typeof p.details === 'object' ? (p.details as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const pick = (k: string): unknown => (p[k] !== undefined ? p[k] : details[k]);
  const codeRaw = pick('code');
  const messageRaw = pick('message');
  const cycleRaw = pick('cycle');
  const out: Partial<ParsedEdsiError> = {};
  if (typeof codeRaw === 'string') out.code = codeRaw;
  if (typeof messageRaw === 'string') out.message = messageRaw;
  if (Array.isArray(cycleRaw)) {
    const strs = cycleRaw.filter((x): x is string => typeof x === 'string');
    if (strs.length > 0) out.cycle = strs;
  }
  return out;
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
  if (json && (json.code || json.message || json.cycle)) {
    return {
      code: json.code ?? null,
      message: json.message ?? (cleaned || prefix),
      cycle: json.cycle ?? null,
      raw: false,
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
