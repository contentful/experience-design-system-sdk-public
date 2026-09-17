import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanPreference } from './BooleanPreference.js';

export const ANALYTICS_HELP = 'Shares anonymous usage data about which CLI commands run.';

export function AnalyticsScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanPreference
      helpText={ANALYTICS_HELP}
      question="Usage analytics"
      labels={{ on: 'Stop sharing usage data', off: 'Keep sharing usage data' }}
      read={(credentials) => credentials.analyticsDisabled}
      write={(credentials, analyticsDisabled) => ({ ...credentials, analyticsDisabled })}
      fallback={false}
      onDone={onDone}
    />
  );
}
