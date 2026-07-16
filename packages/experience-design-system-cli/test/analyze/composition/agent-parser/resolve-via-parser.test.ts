import { describe, it, expect, vi } from 'vitest';
import { resolveViaAgentParser } from '../../../../src/analyze/composition/agent-parser/resolve-via-parser.js';

const files = [{ path: 'm.ts', content: "withParentType('x')" }];
const names = new Set(['Parent', 'Child', 'Other']);

const GOOD_PARSER = [
  '```js',
  'export default function (ctx) {',
  "  return [{ parent: 'Parent', child: 'Child' }];",
  '}',
  '```',
].join('\n');

describe('resolveViaAgentParser', () => {
  it('authors a parser, runs it, returns verified edges (no fallback)', async () => {
    const runAgentFn = vi.fn(async () => GOOD_PARSER);
    const res = await resolveViaAgentParser({ files, componentNames: names, runAgentFn });
    expect(runAgentFn).toHaveBeenCalledTimes(1);
    expect(res.edges).toEqual([{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }]);
    expect(res.usedFallback).toBe(false);
  });

  it('verifies edges against the component name set (drops unknown)', async () => {
    const parser = [
      '```js',
      'export default function (ctx) {',
      "  return [{ parent: 'Parent', child: 'Ghost' }];",
      '}',
      '```',
    ].join('\n');
    const runAgentFn = vi.fn(async () => parser);
    const res = await resolveViaAgentParser({ files, componentNames: names, runAgentFn });
    expect(res.edges).toEqual([]);
    expect(res.warnings.join(' ')).toMatch(/Ghost/);
  });

  it('signals fallback when no parser source can be extracted', async () => {
    const runAgentFn = vi.fn(async () => 'I could not determine the convention.');
    const res = await resolveViaAgentParser({ files, componentNames: names, runAgentFn });
    expect(res.usedFallback).toBe(true);
    expect(res.edges).toEqual([]);
  });

  it('attempts one repair round when the authored parser throws, then succeeds', async () => {
    const throwing = ['```js', 'export default function (ctx) { throw new Error("bad"); }', '```'].join('\n');
    const runAgentFn = vi.fn().mockResolvedValueOnce(throwing).mockResolvedValueOnce(GOOD_PARSER);
    const res = await resolveViaAgentParser({ files, componentNames: names, runAgentFn });
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(res.edges).toEqual([{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }]);
    expect(res.usedFallback).toBe(false);
  });

  it('falls back when the parser still fails after the repair round', async () => {
    const throwing = ['```js', 'export default function (ctx) { throw new Error("bad"); }', '```'].join('\n');
    const runAgentFn = vi.fn(async () => throwing);
    const res = await resolveViaAgentParser({ files, componentNames: names, runAgentFn });
    expect(runAgentFn).toHaveBeenCalledTimes(2); // initial + one repair
    expect(res.usedFallback).toBe(true);
    expect(res.edges).toEqual([]);
  });

  it('passes an onPhase callback the authoring/parsing phases', async () => {
    const phases: string[] = [];
    const runAgentFn = vi.fn(async () => GOOD_PARSER);
    await resolveViaAgentParser({ files, componentNames: names, runAgentFn, onPhase: (p) => phases.push(p) });
    expect(phases).toContain('authoring');
    expect(phases).toContain('parsing');
  });

  it('runs the parser over runtimeFiles, not the (smaller) prompt files', async () => {
    // The prompt sees only 'p.ts'; the parser must see the runtime set and
    // resolve an edge that depends on a file NOT in the prompt.
    const promptOnly = [{ path: 'p.ts', content: 'sample' }];
    const runtime = [
      { path: 'p.ts', content: 'sample' },
      { path: 'extra.ts', content: 'EDGE_MARKER' },
    ];
    // Parser emits an edge only if it finds EDGE_MARKER in ctx.files (runtime).
    const parser = [
      '```js',
      'export default function (ctx) {',
      "  const found = ctx.files.some(f => f.content.includes('EDGE_MARKER'));",
      "  return found ? [{ parent: 'Parent', child: 'Child' }] : [];",
      '}',
      '```',
    ].join('\n');
    const runAgentFn = vi.fn(async () => parser);
    const res = await resolveViaAgentParser({
      files: promptOnly,
      runtimeFiles: runtime,
      componentNames: names,
      runAgentFn,
    });
    // If the parser had only seen promptOnly, it would find nothing → no edges.
    expect(res.edges).toEqual([{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }]);
  });
});
