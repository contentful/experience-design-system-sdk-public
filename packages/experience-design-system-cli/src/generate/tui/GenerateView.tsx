import React from 'react';
import { CommandCompletionView } from '../../tui/CommandCompletionView.js';

export interface GenerateViewResult {
  skill: string;
  agent: string;
  sessionId: string;
}

interface GenerateViewProps {
  result: GenerateViewResult;
  onExit: () => void;
}

export function GenerateView({ result, onExit }: GenerateViewProps): React.ReactElement {
  React.useEffect(() => {
    const timer = setTimeout(onExit, 100);
    return () => clearTimeout(timer);
  }, [onExit]);

  return (
    <CommandCompletionView
      title="generate"
      rows={[
        { label: 'skill', value: result.skill },
        { label: 'agent', value: result.agent },
        { label: 'session', value: result.sessionId },
      ]}
      command={`experience-design-system-cli print ${result.skill}`}
      instruction="to write the output file."
    />
  );
}
