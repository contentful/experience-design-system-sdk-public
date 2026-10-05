import React from 'react';
import { CommandCompletionView } from '../../tui/CommandCompletionView.js';

export interface MapTokensViewResult {
  agent: string;
  sessionId: string;
  applied: number;
  cached: boolean;
}

interface MapTokensViewProps {
  result: MapTokensViewResult;
  onExit: () => void;
}

export function MapTokensView({ result, onExit }: MapTokensViewProps): React.ReactElement {
  React.useEffect(() => {
    const timer = setTimeout(onExit, 100);
    return () => clearTimeout(timer);
  }, [onExit]);

  const summary = result.cached
    ? 'reused from cache'
    : `${result.applied} mapping${result.applied === 1 ? '' : 's'} applied`;

  return (
    <CommandCompletionView
      title="map tokens"
      rows={[
        { label: 'agent', value: result.agent },
        { label: 'session', value: result.sessionId },
        { label: 'result', value: summary },
      ]}
      command="experience-design-system-cli print components"
      instruction="to write components.json with the new mappings."
    />
  );
}
