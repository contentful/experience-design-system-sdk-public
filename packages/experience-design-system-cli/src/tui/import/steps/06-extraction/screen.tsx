import React from 'react';
import { RunningStep } from '../../shared/index.js';
import { progressRows } from './logic.js';
import type { ExtractionProgress } from './types.js';

interface ExtractionScreenProps {
  progress: ExtractionProgress;
  agent: string;
  stepNumber: number;
  totalSteps: number;
}

export function ExtractionScreen({
  progress,
  agent,
  stepNumber,
  totalSteps,
}: ExtractionScreenProps): React.ReactElement {
  return (
    <RunningStep
      stepNumber={stepNumber}
      totalSteps={totalSteps}
      title="Extracting context"
      description="Extracting context from your source files."
      lines={progressRows(progress, agent)}
    />
  );
}
