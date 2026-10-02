import { describe, expect, it } from 'vitest';
import {
  buildComponentsAutonomousPreamble,
  buildMapTokensAutonomousPreamble,
  buildSelectAutonomousPreamble,
  buildTokensAutonomousPreamble,
} from '../../src/generate/services/preambles/index.js';

describe('generation preambles', () => {
  it('renders each stage policy independently around the same context block', () => {
    const context = '\n\nRaw component data (JSON):';

    expect(buildComponentsAutonomousPreamble(context)).toContain('classify_prop');
    expect(buildTokensAutonomousPreamble(context)).toContain('set_token');
    expect(buildSelectAutonomousPreamble(context)).toContain('select_component');
    expect(buildMapTokensAutonomousPreamble(context)).toContain('map_token_prop');
    expect(buildComponentsAutonomousPreamble(context)).toContain(context);
  });
});
