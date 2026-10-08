import { describe, expect, it } from 'vitest';
import { parseEdsiError } from '../../src/controller/errors/parse-edsi-error.js';
import { formatEdsiError } from '../../src/controller/errors/format-edsi-error.js';
import { formatApiError } from '../../src/controller/errors/format-api-error.js';
import { stripLambdaLogPrefix } from '../../src/helpers/edsi-errors/strip-lambda-log-prefix.js';

describe('stripLambdaLogPrefix', () => {
  it('removes a Lambda log prefix with Datadog trace tag', () => {
    const input = '2024-10-08T12:34:56.789Z abc-def ERROR [dd.trace_id=1 dd.span_id=2] some message';
    expect(stripLambdaLogPrefix(input)).toContain('some message');
  });
  it('leaves non-prefixed input alone', () => {
    expect(stripLambdaLogPrefix('plain error')).toBe('plain error');
  });
});

describe('parseEdsiError', () => {
  it('returns raw: true for empty input', () => {
    expect(parseEdsiError({ body: '' })).toEqual({ code: null, message: '', cycle: null, raw: true });
  });
  it('parses a JSON body with code + message', () => {
    const parsed = parseEdsiError({ body: JSON.stringify({ code: 'AccessDenied', message: 'nope' }) });
    expect(parsed.code).toBe('AccessDenied');
    expect(parsed.message).toBe('nope');
    expect(parsed.raw).toBe(false);
  });
});

describe('formatEdsiError', () => {
  it('renders code in brackets + message on next line', () => {
    const out = formatEdsiError({ raw: JSON.stringify({ code: 'AccessDenied', message: 'nope' }) });
    expect(out).toContain('[AccessDenied]');
    expect(out).toContain('nope');
  });
});

describe('formatApiError', () => {
  it('includes guidance when the ApiError carries it', () => {
    const out = formatApiError({ error: { message: 'apply failed: 500', body: 'oops', guidance: 'retry later' } });
    expect(out).toContain('retry later');
  });
});
