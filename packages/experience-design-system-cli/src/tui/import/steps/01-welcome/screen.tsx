import React from 'react';
import { PathStepScreen } from '@tui/shared/components/PathStepScreen.js';
import { toProjectPath } from './logic.js';

interface WelcomeScreenProps {
  onContinue: (projectPath: string) => void;
  onQuit: () => void;
  initialPath?: string;
}

export function WelcomeScreen({ onContinue, onQuit, initialPath = '' }: WelcomeScreenProps): React.ReactElement {
  return (
    <PathStepScreen
      title="Where is your component library?"
      subtitle="The folder with your components. You can use ~, relative, or absolute paths."
      label="Project path"
      initialPath={initialPath}
      toPath={toProjectPath}
      check={(path) => ({ ok: true, path })}
      onContinue={onContinue}
      onBack={onQuit}
    />
  );
}
