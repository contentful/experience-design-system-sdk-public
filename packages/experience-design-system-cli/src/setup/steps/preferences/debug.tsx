import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanPreference } from './BooleanPreference.js';

export const DEBUG_HELP = 'Writes a verbose trace of every command decision, for troubleshooting.';

export function DebugScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanPreference
      helpText={DEBUG_HELP}
      question="Debug logging"
      labels={{ on: 'Write verbose traces', off: 'Stay quiet' }}
      read={(credentials) => credentials.debug}
      write={(credentials, debug) => ({ ...credentials, debug })}
      fallback={false}
      onDone={onDone}
    />
  );
}
