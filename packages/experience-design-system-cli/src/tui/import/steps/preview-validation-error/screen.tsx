import React from 'react';
import { GateStep } from '../../shared/index.js';
import {
  contextText,
  formatErrorLines,
  matchedComponentNames,
  skipLabel,
  type PreviewValidationError,
} from './logic.js';

interface PreviewValidationErrorScreenProps {
  errors: readonly PreviewValidationError[];
  missingNames: readonly string[];
  onEdit: () => void;
  onSkip: () => void;
  onQuit: () => void;
}

export function PreviewValidationErrorScreen({
  errors,
  missingNames,
  onEdit,
  onSkip,
  onQuit,
}: PreviewValidationErrorScreenProps): React.ReactElement {
  const matchedNames = matchedComponentNames(errors, missingNames);

  return (
    <GateStep
      intent="error"
      message="Preview validation failed"
      summary={formatErrorLines(errors)}
      context={contextText(errors, missingNames)}
      continueLabel="Edit definitions"
      skipLabel={skipLabel(matchedNames)}
      onContinue={onEdit}
      onSkip={matchedNames.length > 0 ? onSkip : undefined}
      onQuit={onQuit}
    />
  );
}
