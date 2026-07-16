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

    it('cannot leak from TOP-LEVEL code that runs before the returned function (gap #3)', async () => {
      // The dangerous case the worker model missed: work done at module-eval
      // time, not inside the returned function. In the vm allow-list model
      // there is no process to reach even at top level.
      const src = `
        const leaked = (typeof process !== 'undefined' && process && process.env) ? 'LEAKED' : 'safe';
        export default function(c){ return [{ parent: leaked, child: 'Child', provenance: 'adapter:agent-parser' }]; }
      `;
      const res = await runParserInSandbox(src, { ...ctx, componentNames: ['LEAKED', 'safe', 'Child'] });
      expect(res.edges.map((e) => e.parent)).not.toContain('LEAKED');
    });

    it('has no require in scope (allow-list, not deny-list)', async () => {
      const src = `export default function(c){ require('node:fs'); return []; }`;
      const res = await runParserInSandbox(src, ctx);
      expect(res.error).toBeTruthy();
      expect(res.edges).toEqual([]);
    });

    it('has no Buffer / timers / fetch in scope', async () => {
      for (const cap of ['Buffer', 'setTimeout', 'fetch', 'process', 'globalThis.process']) {
        const src = `export default function(c){ return [{ parent: typeof ${cap} === 'undefined' ? 'safe' : 'LEAKED', child: 'Child', provenance: 'adapter:agent-parser' }]; }`;
        const res = await runParserInSandbox(src, { ...ctx, componentNames: ['safe', 'LEAKED', 'Child'] });
        expect(
          res.edges.map((e) => e.parent),
          `capability ${cap} must be absent`,
        ).not.toContain('LEAKED');
      }
    });

    it('rejects an async parser (closes the async-timeout gap)', async () => {
      const src = `export default async function(c){ return [{ parent: 'Parent', child: 'Child', provenance: 'adapter:agent-parser' }]; }`;
      const res = await runParserInSandbox(src, ctx);
      expect(res.error).toMatch(/synchronous/i);
      expect(res.edges).toEqual([]);
    });

    it('a parser attempting filesystem access yields no data and no crash', async () => {
      // Defense in depth: the vm allow-list has no `require` (first line of
      // defense), and the child runs with --permission so even a runtime-level
      // require of node:fs would be denied. Either way: no file contents leak.
      const src = `export default function(c){
        var leaked = 'safe';
        try { leaked = require('node:fs').readFileSync('/etc/hosts', 'utf8').length ? 'LEAKED' : 'safe'; } catch (e) {}
        return [{ parent: leaked, child: 'Child', provenance: 'adapter:agent-parser' }];
      }`;
      const res = await runParserInSandbox(src, { ...ctx, componentNames: ['LEAKED', 'safe', 'Child'] });
      expect(res.edges.map((e) => e.parent)).not.toContain('LEAKED');
    });

    it('kills a parser that exhausts memory (heap cap)', async () => {
      // Allocate unboundedly; the child's --max-old-space-size self-kills.
      const src = `export default function(c){ const a=[]; for(;;){ a.push(new Array(1e6).fill(0)); } }`;
      const res = await runParserInSandbox(src, ctx, { timeoutMs: 8000 });
      expect(res.edges).toEqual([]);
      expect(res.error).toBeTruthy();
    }, 15000);
  });
});
