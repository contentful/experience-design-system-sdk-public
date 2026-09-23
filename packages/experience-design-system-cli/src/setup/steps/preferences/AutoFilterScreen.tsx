import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanInput } from './BooleanInput.js';

export const AUTO_FILTER_HELP =
  "Filters out components irrelevant to experience orchestration during extraction. Don't worry you can review these components later on.";

export function AutoFilterScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanInput
      helpText={AUTO_FILTER_HELP}
      question="AI auto-filter"
      labels={{ on: 'Use AI to filter out irrelevant components', off: 'Keep every component' }}
      read={(credentials) => credentials.autoFilter}
      write={(credentials, autoFilter) => ({ ...credentials, autoFilter })}
      fallback
      onDone={onDone}
    />
  );
}
