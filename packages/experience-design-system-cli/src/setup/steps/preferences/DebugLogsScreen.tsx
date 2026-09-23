import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanInput } from './BooleanInput.js';

export function DebugLogsScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanInput
      helpText={`Writes a verbose trace of every command decision, for troubleshooting.`}
      question="Debug logging"
      labels={{ on: 'Write verbose traces', off: 'Stay quiet' }}
      read={(credentials) => credentials.debug}
      write={(credentials, debug) => ({ ...credentials, debug })}
      fallback={false}
      onDone={onDone}
    />
  );
}
