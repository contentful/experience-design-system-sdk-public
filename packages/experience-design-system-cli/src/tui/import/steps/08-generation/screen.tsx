import React from 'react';
import { RunningStep } from '../../shared/index.js';
import { describeGeneration, progressRows } from './logic.js';
import type { GenerationProgress } from './types.js';

interface GenerationScreenProps {
  progress: GenerationProgress;
  agent: string;
  acceptedCount: number;
  hasTokens: boolean;
  /** How long each finished row took, by position. */
  rowMs?: ReadonlyArray<number | undefined>;
}

export function GenerationScreen({
  progress,
  agent,
  acceptedCount,
  hasTokens,
  rowMs,
}: GenerationScreenProps): React.ReactElement {
  return (
    <RunningStep
      step="generation"
      description={describeGeneration({ acceptedCount, agent, hasTokens })}
      lines={progressRows(progress, agent, rowMs)}
    />
  );
}
