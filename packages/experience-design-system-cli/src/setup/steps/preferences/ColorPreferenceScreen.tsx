import React from 'react';
import type { StepDone } from '../StepLayout.js';
import { BooleanInput } from './BooleanInput.js';


export function ColorPreferenceScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  return (
    <BooleanInput
      helpText={`Prints plain text with no color, which suits CI logs and basic terminals.`}
      question="Terminal colors"
      labels={{ on: 'Turn colors off', off: 'Keep colors on' }}
      read={(credentials) => credentials.noColor}
      write={(credentials, noColor) => ({ ...credentials, noColor })}
      fallback={false}
      onDone={onDone}
    />
  );
}
