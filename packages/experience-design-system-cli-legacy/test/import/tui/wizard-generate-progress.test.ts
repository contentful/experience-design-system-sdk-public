import { describe, expect, it } from 'vitest';
import { parseGenerateStderrChunk } from '../../../src/import/tui/wizard-generate-progress.js';

type State = { done: number; total: number; current: string } | null;

describe('parseGenerateStderrChunk', () => {
  it('returns prev unchanged when no progress lines appear', () => {
    const prev: State = { done: 2, total: 12, current: 'Modal' };
    expect(parseGenerateStderrChunk('  some unrelated stderr\n', prev)).toEqual(prev);
  });

  it('sets done/total/current from a progress=generate: line', () => {
    expect(parseGenerateStderrChunk('progress=generate:5/12:Modal\n', null)).toEqual({
      done: 5,
      total: 12,
      current: 'Modal',
    });
  });

  it('out-of-order legacy [N/total] lines do NOT increment done past actual completion count', () => {
    // Simulate the bug: legacy line shows worker's START index, not completions.
    // Even though [8/12] looks like 8 done, our parser must not drive `done` from it.
    let state: State = { done: 0, total: 0, current: '' };
    state = parseGenerateStderrChunk('[3/12] Button\n', state);
    expect(state).toEqual({ done: 0, total: 12, current: 'Button' });
    state = parseGenerateStderrChunk('[8/12] Modal\n', state);
    expect(state).toEqual({ done: 0, total: 12, current: 'Modal' });
    state = parseGenerateStderrChunk('[1/12] Spinner\n', state);
    expect(state).toEqual({ done: 0, total: 12, current: 'Spinner' });
  });

  it('legacy [N/total] line after a progress=generate line updates current but not done', () => {
    const prev: State = { done: 5, total: 12, current: 'Modal' };
    const next = parseGenerateStderrChunk('[3/12] Spinner\n', prev);
    expect(next).toEqual({ done: 5, total: 12, current: 'Spinner' });
  });

  it('legacy [N/total] line arriving before any progress=generate line leaves done at prev', () => {
    const next = parseGenerateStderrChunk('[3/12] Spinner\n', null);
    expect(next).toEqual({ done: 0, total: 12, current: 'Spinner' });
  });

  it('handles a chunk containing both line types — progress= wins for done', () => {
    const chunk = '[8/12] Modal\nprogress=generate:5/12:Modal\n[2/12] Button\n';
    const next = parseGenerateStderrChunk(chunk, null);
    // Final state: done=5 from progress= line, current=Button from final legacy.
    expect(next).toEqual({ done: 5, total: 12, current: 'Button' });
  });

  it('preserves prev when chunk is empty', () => {
    const prev: State = { done: 3, total: 12, current: 'Card' };
    expect(parseGenerateStderrChunk('', prev)).toEqual(prev);
  });
});
