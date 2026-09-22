import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { ProfilePreference } from './ProfilePreference.js';

export const CONCURRENCY_HELP = 'Analyzes more components at once, which is faster on machines with spare cores.';

export const PROFILE_VARIABLE = 'EDS_EXTRACT_CONCURRENCY';

export function ConcurrencyScreen({
  profilePath,
  onDone,
}: {
  profilePath: string;
  onDone: StepDone;
}): React.ReactElement {
  return (
    <ProfilePreference
      helpText={CONCURRENCY_HELP}
      question="Performance concurrency"
      labels={{ add: 'Analyze more components at once', skip: 'Leave the default' }}
      variable={PROFILE_VARIABLE}
      lines={`# experiences performance\nexport ${PROFILE_VARIABLE}=8`}
      profilePath={profilePath}
      onDone={onDone}
    />
  );
}
