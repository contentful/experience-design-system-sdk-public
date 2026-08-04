import { describe, it, expect } from 'vitest';
import {
  formatEdsiError,
  parseEdsiError,
  formatParsedEdsiError,
  stripLambdaLogPrefix,
} from '../../src/apply/error-parser.js';

describe('parseEdsiError', () => {
  it('parses a plain JSON body with code / message / cycle', () => {
    const body = JSON.stringify({
      code: 'TopoSortCycleError',
      message: 'ComponentType slot dependency cycle detected among: CycleA, CycleB.',
      cycle: ['CycleA', 'CycleB'],
    });
    const parsed = parseEdsiError(body);
    expect(parsed.code).toBe('TopoSortCycleError');
    expect(parsed.cycle).toEqual(['CycleA', 'CycleB']);
    expect(parsed.message).toMatch(/slot dependency cycle/);
    expect(parsed.raw).toBe(false);
  });

  it('parses a wrapper JSON body with details.code', () => {
    const body = JSON.stringify({
      sys: { type: 'Error', id: 'Rejected' },
      message: 'Apply operation rejected',
      details: { code: 'TopoSortCycleError', cycle: ['A', 'B', 'C'] },
    });
    const parsed = parseEdsiError(body);
    expect(parsed.code).toBe('TopoSortCycleError');
    expect(parsed.cycle).toEqual(['A', 'B', 'C']);
    expect(parsed.raw).toBe(false);
  });

  it('parses a Lambda log-line spill (the exact prod shape from INTEG-4401)', () => {
    const body =
      '2026-07-07T22:26:26.479Z\t6ce7b616-3ace-570b-a4aa-d4d145f041aa\tERROR\t[dd.trace_id=123 dd.span_id=456] Apply operation 920f4821-abcd rejected: ComponentType slot dependency cycle detected among: CycleA, CycleB. Break the cycle by removing at least one $allowedComponents entry. {\n' +
      "  operationId: '920f4821-abcd',\n" +
      "  code: 'TopoSortCycleError',\n" +
      "  cycle: [ 'CycleA', 'CycleB' ]\n" +
      '}';
    const parsed = parseEdsiError(body);
    expect(parsed.code).toBe('TopoSortCycleError');
    expect(parsed.cycle).toEqual(['CycleA', 'CycleB']);
    expect(parsed.message).not.toMatch(/dd\.trace_id/);
    expect(parsed.message).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.message).toMatch(/slot dependency cycle/);
  });

  it('falls back to a cleaned raw body when nothing structured is present', () => {
    const body = 'Unhandled internal error';
    const parsed = parseEdsiError(body);
    expect(parsed.code).toBeNull();
    expect(parsed.cycle).toBeNull();
    expect(parsed.message).toBe('Unhandled internal error');
    expect(parsed.raw).toBe(true);
  });

  it('parses an ApiError.message (prefix + body concatenated with a newline)', () => {
    const body = JSON.stringify({ code: 'ValidationFailed', message: 'nope' });
    const apiErrorMessage = `apply failed: 400\n${body}`;
    const parsed = parseEdsiError(apiErrorMessage);
    expect(parsed.code).toBe('ValidationFailed');
    expect(parsed.message).toBe('nope');
  });

  it('renders a validation error with an empty path without inventing a component or field', () => {
    const body = JSON.stringify({
      sys: { type: 'Error', id: 'ValidationFailed' },
      message: 'Validation error',
      details: { errors: [{ name: 'invalid_union', path: [], details: 'Invalid input' }] },
    });

    const rendered = formatEdsiError(body);

    expect(rendered).toContain('[ValidationFailed]');
    expect(rendered).toContain('- Invalid input');
    expect(rendered).toContain('Location: not provided by the server');
    expect(rendered).toContain('no component or field was identified');
    expect(rendered).not.toContain('Component:');
  });

  it('turns a binding pointer failure into a location-aware diagnostic without object coercion', () => {
    const body =
      'Unable to save component One or more binding configurations are invalid. Pointer path does not exist for \'[object Object]\': Pointer expression path does not exist in input data type. Default › return GraphQL validation error: Field "Link" of type "Link" must have a selection of subfields. Did you mean "Link { ... }"? Default › resolvers › r_-gxsm8Pv7v › query';

    const rendered = formatEdsiError(body);

    expect(rendered).toContain('[BindingValidationFailed]');
    expect(rendered).toContain('Pointer expression path does not exist in input data type');
    expect(rendered).toContain('Field "Link" of type "Link" must have a selection of subfields');
    expect(rendered).toContain('Default › resolvers › r_-gxsm8Pv7v › query');
    expect(rendered).toContain('Next action: review the binding');
    expect(rendered).not.toContain('[object Object]');
  });

  it('formats a binding failure carried in an operation-item error object', () => {
    const message =
      "One or more binding configurations are invalid. Pointer path does not exist for '[object Object]': Pointer expression path does not exist in input data type. Default › resolvers › r_-gxsm8Pv7v › query";

    const rendered = formatEdsiError({ code: 'ValidationFailed', message });

    expect(rendered).toContain('[BindingValidationFailed]');
    expect(rendered).toContain('Default › resolvers › r_-gxsm8Pv7v › query');
    expect(rendered).not.toContain('[object Object]');
  });

  it('is safe on empty / null input', () => {
    expect(parseEdsiError('')).toEqual({ code: null, message: '', cycle: null, raw: true });
    expect(parseEdsiError(null)).toEqual({ code: null, message: '', cycle: null, raw: true });
    expect(parseEdsiError(undefined)).toEqual({ code: null, message: '', cycle: null, raw: true });
  });
});

describe('stripLambdaLogPrefix', () => {
  it('strips the timestamp / request-id / ERROR / dd tags at the head', () => {
    const line =
      '2026-07-07T22:26:26.479Z\t6ce7b616-3ace-570b-a4aa-d4d145f041aa\tERROR\t[dd.trace_id=123 dd.span_id=456] hello';
    expect(stripLambdaLogPrefix(line)).toBe('hello');
  });

  it('is a no-op when no log prefix is present', () => {
    expect(stripLambdaLogPrefix('plain error message')).toBe('plain error message');
  });
});

describe('formatParsedEdsiError', () => {
  it('renders a `[CODE] message + Cycle: …` block for cycle rejections', () => {
    const rendered = formatParsedEdsiError({
      code: 'TopoSortCycleError',
      message: 'ComponentType slot dependency cycle detected among: CycleA, CycleB.',
      cycle: ['CycleA', 'CycleB'],
      raw: false,
    });
    expect(rendered).toMatch(/\[TopoSortCycleError\]/);
    expect(rendered).toMatch(/slot dependency cycle/);
    expect(rendered).toMatch(/Cycle: CycleA → CycleB → CycleA/);
  });

  it('renders just the message when nothing structured is available', () => {
    const rendered = formatParsedEdsiError({
      code: null,
      message: 'Something broke',
      cycle: null,
      raw: true,
    });
    expect(rendered).toBe('Something broke');
  });

  it('appends the raw body under a --- raw --- header when verbose', () => {
    const rendered = formatParsedEdsiError(
      { code: 'X', message: 'oops', cycle: null, raw: false },
      { verbose: true, raw: 'RAW BODY GOES HERE' },
    );
    expect(rendered).toMatch(/--- raw ---/);
    expect(rendered).toMatch(/RAW BODY GOES HERE/);
  });
});
