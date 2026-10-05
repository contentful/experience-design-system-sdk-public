import { describe, expect, it } from 'vitest';
import { parseToolCallLines } from '../../src/generate/services/protocol-parser-service.js';

describe('component protocol parser', () => {
  it('parses component, prop, exclusion, and slot calls with optional fields', () => {
    const result = parseToolCallLines(
      [
        '{"tool":"classify_component","description":"Card","rationale":{"props":"visible"}}',
        '{"tool":"classify_prop","prop":"tone","cdf_type":"enum","cdf_category":"design","values":["light","dark"]}',
        '{"tool":"exclude_prop","prop":"className","reason":"framework detail"}',
        '{"tool":"classify_slot","slot":"body","required":true,"allowed_components":["Text"]}',
      ].join('\n'),
    );

    expect(result.calls).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it('warns and skips invalid property calls', () => {
    const result = parseToolCallLines(
      '{"tool":"classify_prop","prop":"tone","cdf_type":"invalid","cdf_category":"design"}',
    );

    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual(["classify_prop 'tone': invalid cdf_type 'invalid' — skipped"]);
  });
});

describe('parseToolCallLines', () => {
  describe('prose lines', () => {
    it('ignores lines that do not start with {', () => {
      const stdout = [
        'Starting Button classification',
        '{"tool":"classify_component"}',
        'this is a reasoning note',
        '{"tool":"exclude_prop","prop":"className","reason":"framework internal"}',
      ].join('\n');
      const { calls, warnings } = parseToolCallLines(stdout);
      expect(calls).toHaveLength(2);
      expect(warnings).toHaveLength(0);
    });

    it('returns empty calls for stdout with no JSON lines', () => {
      const { calls, warnings } = parseToolCallLines('no json here\njust prose');
      expect(calls).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('classify_component', () => {
    it('parses classify_component with description', () => {
      const { calls } = parseToolCallLines('{"tool":"classify_component","description":"Primary action button"}');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ tool: 'classify_component', description: 'Primary action button' });
    });

    it('parses classify_component without description', () => {
      const { calls } = parseToolCallLines('{"tool":"classify_component"}');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ tool: 'classify_component' });
    });
  });

  describe('classify_prop', () => {
    it('parses a minimal classify_prop', () => {
      const line = '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content"}';
      const { calls, warnings } = parseToolCallLines(line);
      expect(warnings).toHaveLength(0);
      expect(calls[0]).toMatchObject({
        tool: 'classify_prop',
        prop: 'label',
        cdf_type: 'string',
        cdf_category: 'content',
      });
    });

    it('parses all optional fields', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'variant',
        cdf_type: 'enum',
        cdf_category: 'design',
        required: false,
        values: ['primary', 'secondary'],
        default: 'primary',
        description: 'Visual variant',
      });
      const { calls } = parseToolCallLines(line);
      expect(calls[0]).toMatchObject({
        tool: 'classify_prop',
        prop: 'variant',
        cdf_type: 'enum',
        cdf_category: 'design',
        required: false,
        values: ['primary', 'secondary'],
        default: 'primary',
        description: 'Visual variant',
      });
    });

    it('parses token type with token_kind', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'bgColor',
        cdf_type: 'token',
        cdf_category: 'design',
        token_kind: 'color',
      });
      const { calls } = parseToolCallLines(line);
      expect(calls[0]).toMatchObject({ cdf_type: 'token', token_kind: 'color' });
    });

    it('rejects missing prop name', () => {
      const { calls, warnings } = parseToolCallLines(
        '{"tool":"classify_prop","cdf_type":"string","cdf_category":"content"}',
      );
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/missing prop name/);
    });

    it('rejects invalid cdf_type', () => {
      const { calls, warnings } = parseToolCallLines(
        '{"tool":"classify_prop","prop":"href","cdf_type":"link","cdf_category":"content"}',
      );
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/invalid cdf_type.*link/);
    });

    it('rejects invalid cdf_category', () => {
      const { calls, warnings } = parseToolCallLines(
        '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"visual"}',
      );
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/invalid cdf_category.*visual/);
    });

    it('ignores values if not an array of strings', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'size',
        cdf_type: 'enum',
        cdf_category: 'design',
        values: 'not-an-array',
      });
      const { calls } = parseToolCallLines(line);
      expect((calls[0] as { values?: unknown }).values).toBeUndefined();
    });

    it('ignores required if not a boolean', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'label',
        cdf_type: 'string',
        cdf_category: 'content',
        required: 'true',
      });
      const { calls } = parseToolCallLines(line);
      expect((calls[0] as { required?: unknown }).required).toBeUndefined();
    });

    it('parses reason as the LLM internal rationale (Feature 1)', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'label',
        cdf_type: 'string',
        cdf_category: 'content',
        required: true,
        description: 'Button label',
        reason: 'inferred from prop name and PropertySignature; no enum context',
      });
      const { calls, warnings } = parseToolCallLines(line);
      expect(warnings).toHaveLength(0);
      expect(calls[0]).toMatchObject({
        tool: 'classify_prop',
        prop: 'label',
        description: 'Button label',
        reason: 'inferred from prop name and PropertySignature; no enum context',
      });
    });

    it('omits reason when missing (Feature 1, backward compat)', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'label',
        cdf_type: 'string',
        cdf_category: 'content',
      });
      const { calls } = parseToolCallLines(line);
      expect((calls[0] as { reason?: unknown }).reason).toBeUndefined();
    });

    it('ignores reason if not a string (Feature 1)', () => {
      const line = JSON.stringify({
        tool: 'classify_prop',
        prop: 'label',
        cdf_type: 'string',
        cdf_category: 'content',
        reason: 42,
      });
      const { calls } = parseToolCallLines(line);
      expect((calls[0] as { reason?: unknown }).reason).toBeUndefined();
    });
  });

  describe('exclude_prop', () => {
    it('parses exclude_prop with reason', () => {
      const { calls, warnings } = parseToolCallLines(
        '{"tool":"exclude_prop","prop":"className","reason":"CSS class — framework internal"}',
      );
      expect(warnings).toHaveLength(0);
      expect(calls[0]).toEqual({ tool: 'exclude_prop', prop: 'className', reason: 'CSS class — framework internal' });
    });

    it('uses empty string when reason is missing', () => {
      const { calls } = parseToolCallLines('{"tool":"exclude_prop","prop":"ref"}');
      expect(calls[0]).toMatchObject({ tool: 'exclude_prop', prop: 'ref', reason: '' });
    });

    it('rejects missing prop name', () => {
      const { calls, warnings } = parseToolCallLines('{"tool":"exclude_prop","reason":"no name"}');
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/missing prop name/);
    });
  });

  describe('classify_slot', () => {
    it('parses a minimal classify_slot', () => {
      const { calls } = parseToolCallLines('{"tool":"classify_slot","slot":"icon"}');
      expect(calls[0]).toMatchObject({ tool: 'classify_slot', slot: 'icon' });
    });

    it('parses all optional fields', () => {
      const line = JSON.stringify({
        tool: 'classify_slot',
        slot: 'content',
        required: true,
        allowed_components: ['Icon', 'Text'],
        description: 'Primary content slot',
      });
      const { calls } = parseToolCallLines(line);
      expect(calls[0]).toMatchObject({
        tool: 'classify_slot',
        slot: 'content',
        required: true,
        allowed_components: ['Icon', 'Text'],
        description: 'Primary content slot',
      });
    });

    it('rejects missing slot name', () => {
      const { calls, warnings } = parseToolCallLines('{"tool":"classify_slot","required":true}');
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/missing slot name/);
    });

    it('ignores allowed_components if not an array of strings', () => {
      const line = JSON.stringify({
        tool: 'classify_slot',
        slot: 'footer',
        allowed_components: 123,
      });
      const { calls } = parseToolCallLines(line);
      expect((calls[0] as { allowed_components?: unknown }).allowed_components).toBeUndefined();
    });
  });

  describe('trailing content after a complete object', () => {
    it('recovers a call when a stray character follows the object', () => {
      const line =
        '{"tool":"classify_prop","prop":"margin","cdf_type":"enum","cdf_category":"design","values":["none","spacingXs"]}"';
      const { calls, warnings } = parseToolCallLines(line);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ tool: 'classify_prop', prop: 'margin', cdf_type: 'enum' });
      expect(warnings).toEqual(['ignored trailing content after JSON: "']);
    });

    it('handles braces and escaped quotes inside string values', () => {
      const line = '{"tool":"classify_component","description":"renders `<Text>{title}</Text>` and a \\"quote\\""}';
      const { calls, warnings } = parseToolCallLines(line);
      expect(calls).toHaveLength(1);
      expect(warnings).toHaveLength(0);
      expect(calls[0]).toMatchObject({ description: 'renders `<Text>{title}</Text>` and a "quote"' });
    });

    it('still drops and warns when the object itself is incomplete', () => {
      const { calls, warnings } = parseToolCallLines('{"tool":"classify_prop","prop":"margin"');
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/unparseable line/);
    });
  });

  describe('unknown / malformed lines', () => {
    it('warns on unparseable JSON', () => {
      const { calls, warnings } = parseToolCallLines('{broken json}');
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/unparseable line/);
    });

    it('warns on unknown tool name', () => {
      const { calls, warnings } = parseToolCallLines('{"tool":"write_file","path":"/tmp/x"}');
      expect(calls).toHaveLength(0);
      expect(warnings[0]).toMatch(/unknown tool/);
    });

    it('silently skips objects without a tool field', () => {
      const { calls, warnings } = parseToolCallLines('{"foo":"bar"}');
      expect(calls).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('multi-line output', () => {
    it('parses multiple tool calls from a realistic agent response', () => {
      const stdout = [
        'Processing Button component',
        '{"tool":"classify_component","description":"Primary action button"}',
        'label is a required text prop',
        '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true}',
        '{"tool":"classify_prop","prop":"variant","cdf_type":"enum","cdf_category":"design","values":["primary","secondary"]}',
        'disabled is a state prop, correcting category',
        '{"tool":"classify_prop","prop":"disabled","cdf_type":"string","cdf_category":"state","required":false,"default":"false"}',
        '{"tool":"exclude_prop","prop":"className","reason":"framework internal"}',
        '{"tool":"exclude_prop","prop":"onClick","reason":"event handler"}',
        '{"tool":"classify_slot","slot":"icon","required":false,"description":"Optional icon"}',
      ].join('\n');

      const { calls, warnings } = parseToolCallLines(stdout);
      expect(warnings).toHaveLength(0);
      expect(calls).toHaveLength(7);
      expect(calls[0]).toMatchObject({ tool: 'classify_component' });
      expect(calls[1]).toMatchObject({ tool: 'classify_prop', prop: 'label', cdf_type: 'string' });
      expect(calls[2]).toMatchObject({
        tool: 'classify_prop',
        prop: 'variant',
        cdf_type: 'enum',
        values: ['primary', 'secondary'],
      });
      expect(calls[3]).toMatchObject({ tool: 'classify_prop', prop: 'disabled', cdf_category: 'state' });
      expect(calls[4]).toMatchObject({ tool: 'exclude_prop', prop: 'className' });
      expect(calls[5]).toMatchObject({ tool: 'exclude_prop', prop: 'onClick' });
      expect(calls[6]).toMatchObject({ tool: 'classify_slot', slot: 'icon', required: false });
    });

    it('continues parsing after a bad line', () => {
      const stdout = [
        '{"tool":"classify_component"}',
        '{bad json line}',
        '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content"}',
      ].join('\n');
      const { calls, warnings } = parseToolCallLines(stdout);
      expect(calls).toHaveLength(2);
      expect(warnings).toHaveLength(1);
    });
  });
});
