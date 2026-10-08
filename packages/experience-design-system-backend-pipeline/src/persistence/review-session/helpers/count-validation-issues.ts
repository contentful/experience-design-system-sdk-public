import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';

export function countValidationIssues(component: RawComponentDefinition): { errors: number; warnings: number } {
  const issues = component.validationIssues ?? [];
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errors++;
    else if (issue.severity === 'warning') warnings++;
  }
  return { errors, warnings };
}
