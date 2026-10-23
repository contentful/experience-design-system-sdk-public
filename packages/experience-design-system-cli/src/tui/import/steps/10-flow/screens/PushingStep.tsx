import React from 'react';
import { RunningStep } from '../../../shared/index.js';
import type { PushProgress } from '../support/push-progress.js';
import { writtenThings, type Produced } from '../support/produced.js';

type PushingStepProps = {
  progress: PushProgress;
  produced: Produced;
};

export function PushingStep({ progress, produced }: PushingStepProps): React.ReactElement {
  const counted = progress?.kind === 'progress' ? progress : undefined;
  return (
    <RunningStep
      step="push"
      description={`Writing ${writtenThings(produced)} to your Contentful space...`}
      lines={[
        {
          id: 'push',
          text:
            progress?.kind === 'queued'
              ? 'Import queued; waiting for processing…'
              : 'Applying component definitions and design tokens…',
          detail:
            progress?.kind === 'queued'
              ? `Operation: ${progress.operationId}`
              : counted?.current
                ? `Now processing: ${counted.current}`
                : undefined,
          ...(counted
            ? { progress: { done: counted.processed, total: counted.total, label: 'entities processed' } }
            : {}),
        },
      ]}
    />
  );
}
