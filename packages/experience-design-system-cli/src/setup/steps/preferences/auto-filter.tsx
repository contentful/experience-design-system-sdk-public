import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanPreference } from './BooleanPreference.js';

export const AUTO_FILTER_HELP = 'Filters out components irrelevant to experience orchestration during extraction.';

export function AutoFilterScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanPreference
      help={AUTO_FILTER_HELP}
      question="Enable AI auto-filter by default?"
      read={(credentials) => credentials.autoFilter}
      write={(credentials, autoFilter) => ({ ...credentials, autoFilter })}
      fallback
      onDone={onDone}
    />
  );
}
