import { expect, it } from 'vitest';
import { parseToolCallLines, parsePropertyRepresentationProposals, buildPrompt } from '../src/index.js';
it('retains native metadata and typed own defaults in the public parser and prompt transport', async () => {
  const items = { $type: 'number', $required: false, $values: [0, 1] };
  const parsed = parseToolCallLines(
    JSON.stringify({
      tool: 'classify_prop',
      prop: 'values',
      cdf_type: 'array',
      cdf_category: 'content',
      items,
      default: [],
    }),
  );
  expect(parsed.warnings).toEqual([]);
  expect(parsed.calls[0]).toMatchObject({ items, default: [] });
  const prompt = await buildPrompt({
    skill: 'components',
    mode: 'autonomous',
    rawComponentsInline: '[]',
    outDir: '',
    skillContentOverride: 'Preserve native definitions',
  });
  expect(prompt).toContain('array');
  expect(prompt).toContain('typed JSON');
  expect(parsePropertyRepresentationProposals(JSON.stringify({ readiness: 'enabled' })).drafts).toEqual([]);
});
