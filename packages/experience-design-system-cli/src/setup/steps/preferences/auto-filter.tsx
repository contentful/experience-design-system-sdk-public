import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanPreference } from './BooleanPreference.js';

export const AUTO_FILTER_HELP =
  "Filters out components irrelevant to experience orchestration during extraction. Don't worry you can review these components later on.";

export function AutoFilterScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanPreference
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
