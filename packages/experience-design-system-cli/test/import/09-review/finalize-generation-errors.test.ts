import { describe, expect, it } from 'vitest';
import { describeAcceptedGenerationErrors } from '../../../src/tui/import/steps/09-review/helpers/finalize-generation-errors.js';

const error = 'Generation preflight failed:\n/Button/$properties/type/$default: Value outside declared domain';

describe('finalize with generation errors', () => {
  it('blocks an accepted component that still fails generation checks and names its field', () => {
    expect(
      describeAcceptedGenerationErrors([
        { key: 'Card', status: 'accepted' },
        { key: 'Button', status: 'accepted', generationError: error },
      ]),
    ).toBe(
      'Cannot finalize — accepted component has an invalid definition (Button: Generation preflight failed: /Button/$properties/type/$default: Value outside declared domain). Fix or reject it.',
    );
  });

  it('lists every accepted component that still fails', () => {
    expect(
      describeAcceptedGenerationErrors([
        { key: 'Button', status: 'accepted', generationError: 'Unknown slot' },
        { key: 'Card', status: 'accepted', generationError: 'Unknown prop' },
      ]),
    ).toBe(
      'Cannot finalize — accepted components have an invalid definition (Button: Unknown slot; Card: Unknown prop). Fix or reject them.',
    );
  });

  it('allows finalizing when failing components are rejected or left unresolved', () => {
    expect(
      describeAcceptedGenerationErrors([
        { key: 'Button', status: 'rejected', generationError: error },
        { key: 'Card', status: 'needs-review', generationError: error },
        { key: 'Link', status: 'accepted' },
      ]),
    ).toBeNull();
  });
});
