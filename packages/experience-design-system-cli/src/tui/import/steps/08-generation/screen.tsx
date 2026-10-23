import React from 'react';
import { RunningStep } from '../../shared/index.js';
import { describeGeneration, progressRows } from './logic.js';
import type { GenerationProgress } from './types.js';

interface GenerationScreenProps {
  progress: GenerationProgress;
  agent: string;
  acceptedCount: number;
  hasTokens: boolean;
}

export function GenerationScreen({
  progress,
  agent,
  acceptedCount,
  hasTokens,
}: GenerationScreenProps): React.ReactElement {
  return (
    <RunningStep
      step="generation"
      description={describeGeneration({ acceptedCount, agent, hasTokens })}
      lines={progressRows(progress, agent)}
    />
  );
}
