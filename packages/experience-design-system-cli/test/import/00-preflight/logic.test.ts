import { describe, expect, it } from 'vitest';
import { currentInputStep, goBack, stepsFor } from '../../../src/tui/import/steps/00-preflight/logic.js';

describe('the screens of each mode', () => {
  it('has no component stage when only tokens are generated, since there are no components for them to run on', () => {
    const steps = stepsFor('tokens');
    for (const step of [
      'project',
      'path-validation',
      'component-extraction',
      'scope-gate',
      'generation',
      'review',
    ] as const) {
      expect(steps).not.toContain(step);
    }
  });

  it('asks for no token file and generates no tokens when only components are generated', () => {
    const steps = stepsFor('components');
    expect(steps).not.toContain('token-file');
    expect(steps).not.toContain('token-generation');
  });

  it('opens a tokens-only import on the token file, not on the component library', () => {
    expect(currentInputStep('tokens', {})).toBe('token-file');
  });

  it('goes back to the preflight from the first screen of every mode, and otherwise to the screen before', () => {
    for (const target of ['both', 'tokens', 'components'] as const) {
      expect(goBack(target, currentInputStep(target, {}), {})).toEqual({ to: 'preflight' });
    }
    expect(goBack('tokens', 'credentials', { tokensPath: '/t.json' })).toEqual({ to: 'step', answers: {} });
  });
});
