import type { RawComponentDefinition } from '../types.js';
import type { AnalyzeViewResult } from './tui/AnalyzeView.js';

type AnalyzeViewRow = AnalyzeViewResult['components'][number];

/**
 * Build the per-component rows shown in the analyze TUI / non-TTY summary,
 * pairing each filtered component with its corresponding validation result.
 *
 * IMPORTANT — positional indexing is intentional and load-bearing.
 * `validateExtractedComponents` is implemented as `.map()` over its input,
 * so `validatedComponents[i]` always corresponds to `filteredComponents[i]`.
 *
 * We previously keyed validated components by `name` to "avoid a positional
 * dependency" — that got the tradeoff exactly backwards. `Map.set` overwrites
 * by key, so for two components named "Button" only the second's
 * `validationIssues` survived in the Map. The first row's errors then
 * disappeared from `analyzeResult` entirely: no Errors-section entry, no
 * row badge, no count. Pairing by index restores correctness.
 */
export function buildAnalyzeViewRows(
  filteredComponents: RawComponentDefinition[],
  validatedComponents: RawComponentDefinition[],
  allWarnings: string[],
): { rows: AnalyzeViewRow[]; totalErrors: number } {
  if (validatedComponents.length !== filteredComponents.length) {
    // Defensive: caller must pass aligned arrays. If this ever fires we want
    // to know loudly rather than silently mis-pair rows with their issues.
    throw new Error(
      `buildAnalyzeViewRows: validatedComponents length (${validatedComponents.length}) does not match filteredComponents length (${filteredComponents.length})`,
    );
  }

  let totalErrors = 0;
  const rows = filteredComponents.map((c, i) => {
    const validated = validatedComponents[i];
    const errorIssues = (validated.validationIssues ?? []).filter((issue) => issue.severity === 'error');
    totalErrors += errorIssues.length;
    return {
      name: c.name,
      framework: c.framework,
      propCount: c.props.length,
      slotCount: c.slots.length,
      warnings: allWarnings.filter((w) => w.startsWith(c.name + ':')),
      errors: errorIssues.map((issue) => issue.message),
      extractionConfidence: c.extractionConfidence ?? null,
      needsReview: c.needsReview ?? false,
    };
  });

  return { rows, totalErrors };
}
