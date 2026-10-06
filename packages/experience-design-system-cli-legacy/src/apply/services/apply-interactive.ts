import React, { createElement } from 'react';
import { ApiError, ImportApiClient } from '../api-client.js';
import { formatApiError } from '../../lib/error-parser.js';
import { recordApplyOutcome } from '../../analytics/index.js';
import { ServerApplyProgress, ServerApplyDone } from '../tui/ServerApplyView.js';
import { pollApplyOperation } from '../helpers/poll-apply-operation.js';
import type { ApplyOperationResponse } from '@contentful/experience-design-system-types';

type ApplyProgressStatus = 'applying' | 'polling' | 'error';

function renderApplyProgress(
  rerender: (element: React.ReactElement) => void,
  spaceId: string,
  environmentId: string,
  status: ApplyProgressStatus,
  details: { operationId?: string; error?: string } = {},
): void {
  rerender(
    createElement(ServerApplyProgress, {
      spaceId,
      environmentId,
      status,
      ...details,
    }),
  );
}

export interface ApplyInteractiveOptions {
  client: ImportApiClient;
  cdf: Parameters<ImportApiClient['applyImport']>[0];
  spaceId: string;
  environmentId: string;
  host?: string;
  acknowledgeBreakingChanges: boolean;
  rerender: (element: React.ReactElement) => void;
  onDone: () => void;
}

export async function applyInteractive(options: ApplyInteractiveOptions): Promise<void> {
  const operation = await pollApplyOperation(options.client, options.cdf, {
    acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    onProgress: (status, operationId) => {
      renderApplyProgress(options.rerender, options.spaceId, options.environmentId, status, { operationId });
    },
    onApiError: (error: ApiError) => {
      renderApplyProgress(options.rerender, options.spaceId, options.environmentId, 'error', {
        error: formatApiError(error),
      });
    },
  });
  if (!operation) return;

  recordApplyOutcome(options.client, options.spaceId, options.environmentId, operation as ApplyOperationResponse);
  options.rerender(
    createElement(ServerApplyDone, {
      operation: operation as ApplyOperationResponse,
      spaceId: options.spaceId,
      environmentId: options.environmentId,
      host: options.host,
    }),
  );
  options.onDone();
}
