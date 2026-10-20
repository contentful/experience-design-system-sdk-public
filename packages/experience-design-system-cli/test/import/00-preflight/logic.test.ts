import { describe, expect, it } from 'vitest';
import { stepsFor } from '../../../src/tui/import/steps/00-preflight/logic.js';

describe('stepsFor', () => {
  it('has no component stage when only tokens are generated, since there are no components for them to run on', () => {
    const steps = stepsFor('tokens');
    for (const step of ['path-validation', 'component-extraction', 'scope-gate', 'generation', 'review'] as const) {
      expect(steps).not.toContain(step);
    }
  });

  it('asks for no token file and generates no tokens when only components are generated', () => {
    const steps = stepsFor('components');
    expect(steps).not.toContain('token-file');
    expect(steps).not.toContain('token-generation');
  });
});
