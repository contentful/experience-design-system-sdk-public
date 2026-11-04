import React from 'react';
import { RunningStep } from '../../shared/index.js';
import { progressRows } from './logic.js';
import type { ExtractionProgress } from './types.js';

interface ExtractionScreenProps {
  progress: ExtractionProgress;
  agent: string;
}

export function ExtractionScreen({ progress, agent }: ExtractionScreenProps): React.ReactElement {
  return (
    <RunningStep
      step="extraction"
      description="Extracting context from your source files."
      elapsedLabel="Total extraction time"
      lines={progressRows(progress, agent)}
    />
  );
}
