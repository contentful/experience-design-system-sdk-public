import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanInput } from './BooleanInput.js';

export const ANALYTICS_HELP =
  'Shares anonymous usage data about which CLI commands are used and where imports succeed or fail. Never includes source code, file paths, credentials, or authored content';

export function AnalyticsScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanInput
      helpText={ANALYTICS_HELP}
      question="Anonymous usage analytics"
      labels={{ on: "Don't share usage data", off: 'Keep sharing usage data' }}
      read={(credentials) => credentials.analyticsDisabled}
      write={(credentials, analyticsDisabled) => ({ ...credentials, analyticsDisabled })}
      fallback={false}
      onDone={onDone}
    />
  );
}
