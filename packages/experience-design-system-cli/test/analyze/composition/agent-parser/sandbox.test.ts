import { describe, it, expect } from 'vitest';
import { runParserInSandbox } from '../../../../src/analyze/composition/agent-parser/sandbox.js';

const ctx = {
  files: [{ path: 'a.ts', content: "withParentType('Parent')" }],
  componentNames: ['Parent', 'Child'],
};

describe('runParserInSandbox', () => {
  it('runs a benign parser and returns its edges', async () => {
    const src = `export default function(ctx) {
      return [{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }];
    }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.error).toBeUndefined();
    expect(res.edges).toEqual([{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }]);
  });

  it('receives the ctx (files + componentNames)', async () => {
    const src = `export default function(ctx) {
      return ctx.componentNames.map((n) => ({ parent: n, child: n, provenance: 'adapter:agent-parser' }));
    }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.edges).toHaveLength(2);
  });

  it('denies filesystem access (no require/import of node:fs)', async () => {
    const src = `export default function(ctx) {
      const fs = require('node:fs');
      fs.readFileSync('/etc/passwd');
      return [];
    }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.edges).toEqual([]);
    expect(res.error).toBeTruthy();
  });

  it('denies process access', async () => {
    const src = `export default function(ctx) {
      return [{ parent: process.env.HOME ?? 'x', child: 'y', provenance: 'adapter:agent-parser' }];
    }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.error).toBeTruthy();
    expect(res.edges).toEqual([]);
  });

  it('kills an infinite loop via timeout', async () => {
    const src = `export default function(ctx) { while (true) {} }`;
    const res = await runParserInSandbox(src, ctx, { timeoutMs: 500 });
    expect(res.error).toMatch(/timeout|timed out/i);
    expect(res.edges).toEqual([]);
  }, 5000);

  it('captures a thrown error and returns empty edges', async () => {
    const src = `export default function(ctx) { throw new Error('boom'); }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.error).toMatch(/boom/);
    expect(res.edges).toEqual([]);
  });

  it('rejects a non-array return', async () => {
    const src = `export default function(ctx) { return { not: 'an array' }; }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.error).toBeTruthy();
    expect(res.edges).toEqual([]);
  });

  it('drops malformed edges (missing parent/child) but keeps well-formed ones', async () => {
    const src = `export default function(ctx) {
      return [
        { parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' },
        { parent: 'Parent' },
        { child: 'Child' },
        'nope',
      ];
    }`;
    const res = await runParserInSandbox(src, ctx);
    expect(res.edges).toEqual([{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }]);
  });

  it('handles a parser that is not a function', async () => {
    const res = await runParserInSandbox(`export default 42;`, ctx);
    expect(res.error).toBeTruthy();
    expect(res.edges).toEqual([]);
  });

  it('handles source that fails to compile', async () => {
    const res = await runParserInSandbox(`export default function( {{{ syntax error`, ctx);
    expect(res.error).toBeTruthy();
    expect(res.edges).toEqual([]);
  });

  describe('escape resistance (security-critical — must never regress)', () => {
    it('cannot reach process via globalThis', async () => {
      const src = `export default function(c){
        return [{ parent: globalThis.process.env.HOME || 'x', child: 'y', provenance: 'adapter:agent-parser' }];
      }`;
      const res = await runParserInSandbox(src, ctx);
      // process is undefined → reading .env throws → captured, no leak.
      expect(res.edges).toEqual([]);
      expect(res.error).toBeTruthy();
    });

    it('cannot escape via the Function constructor', async () => {
      const src = `export default function(c){
        const leaked = (()=>{}).constructor('return globalThis.process')();
        return [{ parent: leaked ? 'LEAKED' : 'safe', child: 'y', provenance: 'adapter:agent-parser' }];
      }`;
      const res = await runParserInSandbox(src, ctx);
      // The Function constructor is poisoned → either throws (empty) or the
      // parser reaches the 'safe' branch. It must NEVER report LEAKED.
      const parents = res.edges.map((e) => e.parent);
      expect(parents).not.toContain('LEAKED');
    });

    it('cannot dynamically import node builtins', async () => {
      const src = `export default async function(c){ await import('node:child_process'); return []; }`;
      const res = await runParserInSandbox(src, ctx);
      expect(res.edges).toEqual([]);
    });

    it('cannot reach eval', async () => {
      const src = `export default function(c){
        const p = eval('globalThis.process');
        return [{ parent: p ? 'LEAKED' : 'safe', child: 'y', provenance: 'adapter:agent-parser' }];
      }`;
      const res = await runParserInSandbox(src, ctx);
      expect(res.edges.map((e) => e.parent)).not.toContain('LEAKED');
    });
  });
});
