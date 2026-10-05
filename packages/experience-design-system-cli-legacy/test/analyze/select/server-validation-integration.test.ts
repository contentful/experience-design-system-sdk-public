import { describe, it, expect } from 'vitest';
import { shouldExcludeDueToValidation } from '@contentful/experience-design-system-extraction';
import { countValidationIssues, createReviewSessionSummary } from '../../../src/analyze/select/types.js';
import type { ReviewSessionSnapshot } from '../../../src/analyze/select/types.js';
import type { RawComponentDefinition } from '../../../src/types.js';

function makeComponent(
  name: string,
  validationIssues: RawComponentDefinition['validationIssues'],
): RawComponentDefinition {
  return {
    name,
    source: `/tmp/${name}.tsx`,
    framework: 'react',
    props: [],
    slots: [],
    ...(validationIssues ? { validationIssues } : {}),
  };
}

function makeSnapshot(components: RawComponentDefinition[]): ReviewSessionSnapshot {
  return {
    components: components.map((c) => ({
      id: `${c.name}-id`,
      name: c.name,
      resolvedSourcePath: c.source,
      sourceCode: null,
      originalProposal: c,
      editedProposal: c,
      status: 'needs-review',
    })),
  };
}

describe('SERVER_VALIDATION_FAILED — SP-1 contract integration', () => {
  it('shouldExcludeDueToValidation returns true for SERVER_VALIDATION_FAILED', () => {
    // Load-bearing: this is what the SP-1 predicate uses to decide whether
    // bulk-approve should auto-reject a component. If this changes, the
    // wizard "skip and retry" + analyze-select --select-all behaviors both
    // shift in lock-step.
    const proposal = makeComponent('PageLink', [
      { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'server says no' },
    ]);
    expect(shouldExcludeDueToValidation(proposal)).toBe(true);
  });

  it('SERVER_VALIDATION_FAILED behaves like other error-severity codes for bulk-approve auto-rejection', () => {
    // The runNonInteractive `--select-all --exclude-invalid` path filters
    // components by shouldExcludeDueToValidation; this test pins that
    // SERVER_VALIDATION_FAILED slots into that predicate alongside extraction-time
    // codes. Without it, the wizard's "skip and retry" → re-run analyze select
    // path would silently re-include components the server already rejected.
    const good = makeComponent('Good', undefined);
    const bad = makeComponent('Bad', [
      { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'fails server validation' },
    ]);
    expect(shouldExcludeDueToValidation(good)).toBe(false);
    expect(shouldExcludeDueToValidation(bad)).toBe(true);
  });

  it('snapshots with SERVER_VALIDATION_FAILED partition correctly via shouldExcludeDueToValidation', () => {
    // Mirrors the previous partitionForExcludeInvalid test but exercises the
    // public predicate that the headless --exclude-invalid path uses.
    const components = [
      makeComponent('Good', undefined),
      makeComponent('Bad', [{ severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'fails' }]),
      makeComponent('AlsoBad', [
        { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'also fails' },
        { severity: 'warning', code: 'EMPTY_COMPONENT', message: 'unrelated warn' },
      ]),
    ];

    const invalid = components.filter(shouldExcludeDueToValidation).map((c) => c.name);
    const valid = components.filter((c) => !shouldExcludeDueToValidation(c)).map((c) => c.name);

    expect(invalid.sort()).toEqual(['AlsoBad', 'Bad']);
    expect(valid).toEqual(['Good']);
  });

  it('countValidationIssues counts SERVER_VALIDATION_FAILED as an error so the Sidebar warning badge renders', () => {
    // The wizard's preview-validation-error path injects SERVER_VALIDATION_FAILED
    // into the review state file before relaunching the analyze-select TUI.
    // The Sidebar uses createReviewSessionSummary().validationErrorCount > 0 to
    // pin offending components to the top with a red ⚠. If countValidationIssues
    // missed our new code, the patched components would silently render normally.
    const proposal = makeComponent('Bad', [
      { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'a' },
      { severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'b' },
      { severity: 'warning', code: 'EMPTY_COMPONENT', message: 'unrelated' },
    ]);
    const counts = countValidationIssues(proposal);
    expect(counts).toEqual({ errors: 2, warnings: 1 });
  });

  it('createReviewSessionSummary surfaces SERVER_VALIDATION_FAILED in validationErrorCount', () => {
    const snapshot = makeSnapshot([
      makeComponent('Bad', [{ severity: 'error', code: 'SERVER_VALIDATION_FAILED', message: 'fails' }]),
    ]);
    const summary = createReviewSessionSummary(snapshot);
    const bad = summary.components.find((c) => c.name === 'Bad')!;
    expect(bad.validationErrorCount).toBe(1);
  });
});
