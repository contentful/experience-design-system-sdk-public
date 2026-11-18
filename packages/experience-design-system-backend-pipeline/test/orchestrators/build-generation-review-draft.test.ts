import { describe, expect, it } from 'vitest';
import { buildGenerationReviewDraft } from '../../src/orchestrators/run-generate-components-session/helpers/build-generation-review-draft.js';

const base = { $type: 'component' as const, $properties: {} };

describe('excluded properties in retained proposals', () => {
  it.each(['boolean', 'string', 'number'])('uses the extracted %s type after a prior classification', (type) => {
    const stdout = [
      { tool: 'classify_prop', prop: 'value', cdf_type: 'enum', cdf_category: 'design', values: ['a'] },
      { tool: 'exclude_prop', prop: 'value' },
    ]
      .map((call) => JSON.stringify(call))
      .join('\n');
    const draft = buildGenerationReviewDraft(stdout, base, [{ name: 'value', type, required: false }]);
    expect(draft.$properties.value).toEqual({
      $type: type === 'boolean' ? 'boolean' : 'string',
      $category: 'unattached',
    });
  });
});
