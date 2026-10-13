import React from 'react';
import { RunningStep } from '../../shared/index.js';
import { describeGeneration, progressRows } from './logic.js';
import type { GenerationProgress } from './types.js';

interface GenerationScreenProps {
  progress: GenerationProgress;
  agent: string;
  acceptedCount: number;
  hasTokens: boolean;
  stepNumber: number;
  totalSteps: number;
}

export function GenerationScreen({
  progress,
  agent,
  acceptedCount,
  hasTokens,
  stepNumber,
  totalSteps,
}: GenerationScreenProps): React.ReactElement {
  return (
    <RunningStep
      stepNumber={stepNumber}
      totalSteps={totalSteps}
      title="Generating definitions"
      description={describeGeneration({ acceptedCount, agent, hasTokens })}
      lines={progressRows(progress, agent)}
    />
  );
}
