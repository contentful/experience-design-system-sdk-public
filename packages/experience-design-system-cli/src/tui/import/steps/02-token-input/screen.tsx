import React from 'react';
import { PathStepScreen } from '@tui/shared/components/PathStepScreen.js';
import { toTokenPath } from './logic.js';
import { validateTokenPath } from './validate-path.js';

interface TokenInputScreenProps {
  onConfirm: (tokensPath: string) => void;
  onBack: () => void;
  initialPath?: string;
}

export function TokenInputScreen({ onConfirm, onBack, initialPath = '' }: TokenInputScreenProps): React.ReactElement {
  return (
    <PathStepScreen
      title="Design tokens"
      subtitle="Point me to your raw token file (e.g. ~/design-tokens/tokens.json). You can use ~, relative, or absolute paths. Claude will map it to Design Token Group Format (DTCG)."
      label="Token path"
      initialPath={initialPath}
      toPath={toTokenPath}
      check={validateTokenPath}
      onContinue={onConfirm}
      onBack={onBack}
    />
  );
}
