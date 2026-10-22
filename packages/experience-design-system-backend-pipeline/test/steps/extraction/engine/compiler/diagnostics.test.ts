import { expect, it } from 'vitest';
import { mergeExtractionDiagnostics } from '../../../../../src/steps/extraction/src/compiler/diagnostics.js';
import type { ExtractionDiagnostics } from '../../../../../src/steps/extraction/src/candidates/types.js';

it('does not double-count an identical diagnostic receipt forwarded by successive phases', () => {
  const receipt: ExtractionDiagnostics = {
    schemaVersion: 1,
    projects: [],
    modules: [
      {
        specifier: 'source-candidates:Example',
        fromPath: '/src/Example.tsx',
        outcome: 'unavailable',
        reason: 'source-candidate-budget-exhausted:3',
      },
    ],
    references: [],
    coverage: 'partial',
    limits: { maxSourceCandidates: 2048 },
    used: { sourceCandidatesOmitted: 3 },
  };
  const result = mergeExtractionDiagnostics([receipt, JSON.parse(JSON.stringify(receipt))]);
  expect(result?.modules).toHaveLength(1);
  expect(result?.used.sourceCandidatesOmitted).toBe(3);
});
