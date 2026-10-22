import { describe, expect, it } from 'vitest';
import { currentInputStep, goBack, stepsFor } from '../../../src/tui/import/steps/00-preflight/logic.js';

describe('the screens of each mode', () => {
  it('has no component stage when only tokens are generated, since there are no components for them to run on', () => {
    const steps = stepsFor('tokens');
    for (const step of ['component-extraction', 'scope-gate', 'generation', 'review'] as const) {
      expect(steps).not.toContain(step);
    }
  });

  it('asks for no token file and generates no tokens when only components are generated', () => {
    const steps = stepsFor('components');
    expect(steps).not.toContain('token-generation');
  });

  it('opens every mode on the inputs screen, and moves on to credentials once it is confirmed', () => {
    for (const target of ['both', 'tokens', 'components'] as const) {
      expect(currentInputStep(target, {})).toBe('inputs');
      expect(currentInputStep(target, { confirmed: true })).toBe('credentials');
    }
  });

  it('goes back to the preflight from the first screen of every mode, and otherwise to the screen before', () => {
    for (const target of ['both', 'tokens', 'components'] as const) {
      expect(goBack(target, currentInputStep(target, {}), {})).toEqual({ to: 'preflight' });
    }
  });

  it('keeps the paths when going back to the inputs screen, so it opens filled in', () => {
    const answers = { projectPath: '/p', tokensPath: '/t.json', scannedFiles: ['/p/a.tsx'], confirmed: true };
    const { confirmed: _confirmed, ...kept } = answers;
    expect(goBack('both', 'credentials', answers)).toEqual({ to: 'step', answers: kept });
  });
});
