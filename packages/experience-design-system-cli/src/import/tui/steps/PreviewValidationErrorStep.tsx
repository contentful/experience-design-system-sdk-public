import React from 'react';
import { GateStep } from './GateStep.js';
import type { PreviewValidationError } from '../../../apply/api-client.js';

type PreviewValidationErrorStepProps = {
  errors: PreviewValidationError[];
  missingNames: string[];
  onEdit: () => void;
  onSkip: () => void;
  onQuit: () => void;
};

export function PreviewValidationErrorStep({
  errors,
  missingNames,
  onEdit,
  onSkip,
  onQuit,
}: PreviewValidationErrorStepProps): React.ReactElement {
  const uniqueNames = [...new Set(errors.map((e) => e.componentName))];
  const matchedNames = uniqueNames.filter((n) => !missingNames.includes(n));
  const errorLines = errors.map((e) => `  ${e.componentName}: ${e.message}`).join('\n');

  const missingNote =
    missingNames.length > 0
      ? `\n\nNote: ${missingNames.length} component name${
          missingNames.length === 1 ? '' : 's'
        } from the server (${missingNames.join(', ')}) ${
          missingNames.length === 1 ? 'does' : 'do'
        } not match anything in this session — they cannot be edited or skipped from here.`
      : '';

  const skipLabel =
    matchedNames.length === 0
      ? 'No matching components to skip'
      : `Skip ${matchedNames.length === 1 ? matchedNames[0] : `${matchedNames.length} components`} and retry`;

  return (
    <GateStep
      intent="error"
      successMessage="Preview validation failed"
      summary={errorLines}
      context={`${uniqueNames.length} component${uniqueNames.length === 1 ? '' : 's'} failed server validation. Edit their definitions in the review TUI, or skip them and retry preview without them.${missingNote}`}
      continueLabel="Edit definitions"
      skipLabel={skipLabel}
      showSkip={matchedNames.length > 0}
      onContinue={onEdit}
      onSkip={onSkip}
      onQuit={onQuit}
    />
  );
}
