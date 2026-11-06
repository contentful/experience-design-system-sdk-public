import React from 'react';
import { RunningStep } from '../../shared/index.js';
import { progressRows } from './logic.js';
import type { ExtractionProgress } from './types.js';

interface ExtractionScreenProps {
  progress: ExtractionProgress;
  agent: string;
  /** How long each finished row took, by position. */
  rowMs?: ReadonlyArray<number | undefined>;
}

export function ExtractionScreen({ progress, agent, rowMs }: ExtractionScreenProps): React.ReactElement {
  return (
    <RunningStep
      step="extraction"
      description="Extracting context from your source files."
      lines={progressRows(progress, agent, rowMs)}
    />
  );
}
