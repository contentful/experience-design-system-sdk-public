import React from 'react';
import { GateStep } from '../../shared/index.js';
import { gateText } from './logic.js';

interface TokenReuseScreenProps {
  tokensPath: string;
  sourceChanged: boolean;
  onReuse: () => void;
  onRegenerate: () => void;
  onQuit: () => void;
}

export function TokenReuseScreen({
  tokensPath,
  sourceChanged,
  onReuse,
  onRegenerate,
  onQuit,
}: TokenReuseScreenProps): React.ReactElement {
  const { summary, context } = gateText({ tokensPath, sourceChanged });

  return (
    <GateStep
      step="setup"
      message="Existing tokens.json found"
      summary={summary}
      context={context}
      continueLabel="Reuse existing tokens"
      skipLabel="Regenerate tokens"
      onContinue={onReuse}
      onSkip={onRegenerate}
      onQuit={onQuit}
    />
  );
}
