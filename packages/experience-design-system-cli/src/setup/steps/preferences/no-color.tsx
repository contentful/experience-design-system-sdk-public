import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { ProfilePreference } from './ProfilePreference.js';

export const NO_COLOR_HELP = 'Prints plain text with no color, which suits CI logs and basic terminals.';

const PROFILE_VARIABLE = 'NO_COLOR';

export function NoColorScreen({ profilePath, onDone }: { profilePath: string; onDone: StepDone }): React.ReactElement {
  return (
    <ProfilePreference
      help={NO_COLOR_HELP}
      question="Turn off colored output?"
      variable={PROFILE_VARIABLE}
      lines={`export ${PROFILE_VARIABLE}=1`}
      profilePath={profilePath}
      onDone={onDone}
    />
  );
}
