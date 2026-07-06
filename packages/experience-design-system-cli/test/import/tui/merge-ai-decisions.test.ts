import { describe, expect, it } from 'vitest';
import { mergeAiDecisions } from '../../../src/import/tui/merge-ai-decisions.js';

// INTEG-4318: the wizard's scope-gate loads component rows from raw_components
// where status is one of extracted/accepted/rejected. If the select-agent
// omits a decision for a component (batch under-emit), the row's DB status
// stays 'extracted' and never surfaces as 'failed' to the operator. The
// streaming stderr progress lines DO carry the 'failed' decision — this
// helper is what layers them onto the DB-loaded components before render so
// the scope-gate can exclude them safely.

describe('mergeAiDecisions', () => {
  const BASE = [
    { name: 'Button', componentId: 'c0', aiDecision: null, aiReason: null },
    { name: 'Card', componentId: 'c1', aiDecision: null, aiReason: null },
    { name: 'DroppedByLLM', componentId: 'c2', aiDecision: null, aiReason: null },
  ] as const;

  it('overlays a failed streaming decision onto a component with no DB decision', () => {
    const merged = mergeAiDecisions(BASE, {
      DroppedByLLM: { decision: 'failed', reason: 'no-tool-call-from-agent' },
    });
    const dropped = merged.find((c) => c.name === 'DroppedByLLM');
    expect(dropped?.aiDecision).toBe('failed');
    expect(dropped?.aiReason).toBe('no-tool-call-from-agent');
  });

  it('does not touch components missing from the aiDecisions map', () => {
    const merged = mergeAiDecisions(BASE, {
      DroppedByLLM: { decision: 'failed', reason: 'no-tool-call-from-agent' },
    });
    expect(merged.find((c) => c.name === 'Button')?.aiDecision).toBeNull();
    expect(merged.find((c) => c.name === 'Card')?.aiDecision).toBeNull();
  });

  it('lets the DB-loaded rejected decision win over an older streamed accepted decision', () => {
    // The DB row is the source of truth once the child process has closed
    // (the child writes raw_components.status directly). The streamed map is
    // a fallback for cases the DB does not capture (failed/no-tool-call). If
    // both exist and disagree, DB wins.
    const withDbDecision = [
      { name: 'Button', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: 'db-reason' },
    ];
    const merged = mergeAiDecisions(withDbDecision, {
      Button: { decision: 'accepted', reason: 'stream-reason' },
    });
    expect(merged[0]!.aiDecision).toBe('rejected');
    expect(merged[0]!.aiReason).toBe('db-reason');
  });

  it('returns a new array without mutating the input', () => {
    const input = [...BASE];
    const merged = mergeAiDecisions(input, {
      DroppedByLLM: { decision: 'failed', reason: 'no-tool-call-from-agent' },
    });
    expect(merged).not.toBe(input);
    expect(input[2]!.aiDecision).toBeNull();
  });

  it('returns the components unchanged when the aiDecisions map is empty', () => {
    const merged = mergeAiDecisions(BASE, {});
    expect(merged).toHaveLength(BASE.length);
    expect(merged.every((c, i) => c.aiDecision === BASE[i]!.aiDecision)).toBe(true);
  });
});
