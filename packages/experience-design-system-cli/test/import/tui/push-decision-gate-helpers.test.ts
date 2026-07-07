import { describe, expect, it } from 'vitest';
import { chooseGateAction } from '../../../src/import/tui/push-decision-gate-helpers.js';

describe('chooseGateAction', () => {
  it('maps "both" to "save-and-push"', () => {
    expect(chooseGateAction('both')).toBe('save-and-push');
  });

  it('passes "push-only" through unchanged', () => {
    expect(chooseGateAction('push-only')).toBe('push-only');
  });

  it('passes "save-only" through unchanged', () => {
    expect(chooseGateAction('save-only')).toBe('save-only');
  });
});
