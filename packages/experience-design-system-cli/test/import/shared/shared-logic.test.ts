import { describe, expect, it } from 'vitest';
import { errorAction, errorControls } from '../../../src/tui/import/shared/error-step/logic.js';
import { gateAction, gateControls } from '../../../src/tui/import/shared/gate-step/logic.js';
import { formatElapsed, progressPercent, stepLabel } from '../../../src/tui/import/shared/running-step/logic.js';

const noKey = { return: false, escape: false };

describe('gateAction', () => {
  it('continues on Enter and quits on Esc', () => {
    expect(gateAction('', { ...noKey, return: true }, true)).toBe('continue');
    expect(gateAction('', { ...noKey, escape: true }, true)).toBe('quit');
  });

  it('skips on a only when skipping is available', () => {
    expect(gateAction('a', noKey, true)).toBe('skip');
    expect(gateAction('a', noKey, false)).toBeNull();
  });

  it('does not treat q as quit', () => {
    expect(gateAction('q', noKey, true)).toBeNull();
  });
});

describe('gateControls', () => {
  it('lists the skip hint only when skipping is available', () => {
    expect(gateControls('Continue', 'Skip', true).map((control) => control.keys)).toEqual(['Enter', 'a', 'Esc']);
    expect(gateControls('Continue', 'Skip', false).map((control) => control.keys)).toEqual(['Enter', 'Esc']);
  });
});

describe('errorAction', () => {
  const none = { canRetry: false, canAcknowledge: false };

  it('exits on Enter or Esc by default', () => {
    expect(errorAction('', { ...noKey, return: true }, none)).toBe('exit');
    expect(errorAction('', { ...noKey, escape: true }, none)).toBe('exit');
  });

  it('acknowledges on Enter when breaking changes can be acknowledged, and Esc still exits', () => {
    const available = { canRetry: false, canAcknowledge: true };
    expect(errorAction('', { ...noKey, return: true }, available)).toBe('acknowledge');
    expect(errorAction('', { ...noKey, escape: true }, available)).toBe('exit');
  });

  it('retries on r only when retry is available', () => {
    expect(errorAction('r', noKey, { canRetry: true, canAcknowledge: false })).toBe('retry');
    expect(errorAction('r', noKey, none)).toBeNull();
  });
});

describe('errorControls', () => {
  it('shows Exit alone by default', () => {
    expect(errorControls({ canRetry: false, canAcknowledge: false })).toEqual([{ keys: 'Enter', label: 'Exit' }]);
  });

  it('shows acknowledge, exit and retry together', () => {
    expect(errorControls({ canRetry: true, canAcknowledge: true }).map((control) => control.keys)).toEqual([
      'Enter',
      'Esc',
      'r',
    ]);
  });
});

describe('running step helpers', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(7)).toBe('7s');
    expect(formatElapsed(125)).toBe('2m 5s');
  });

  it('clamps progress to 0-100 and survives an empty total', () => {
    expect(progressPercent({ done: 1, total: 4 })).toBe(25);
    expect(progressPercent({ done: 9, total: 4 })).toBe(100);
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
  });

  it('labels a step with its position', () => {
    expect(stepLabel(2, 5, 'Extracting')).toBe('Step 2 of 5 — Extracting');
  });
});
