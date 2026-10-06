import { ApiError, ImportApiClient } from '../api-client.js';
import type { ApplyOperationResponse } from '@contentful/experience-design-system-types';

export interface PollApplyOptions {
  acknowledgeBreakingChanges: boolean;
  onProgress?: (status: 'applying' | 'polling', operationId?: string) => void;
  onStarted?: (operationId: string) => void;
  onApiError: (error: ApiError) => Promise<void> | void;
}

export async function pollApplyOperation(
  client: ImportApiClient,
  cdf: Parameters<ImportApiClient['applyImport']>[0],
  options: PollApplyOptions,
): Promise<ApplyOperationResponse | null> {
  options.onProgress?.('applying');

  let operation: ApplyOperationResponse;
  try {
    operation = await client.applyImport(cdf, {
      acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      await options.onApiError(e);
      return null;
    }
    throw e;
  }

  options.onStarted?.(operation.sys.id);
  options.onProgress?.('polling', operation.sys.id);

  try {
    operation = await client.pollOperation(operation.sys.id);
  } catch (e) {
    if (e instanceof ApiError) {
      await options.onApiError(e);
      return null;
    }
    throw e;
  }

  return operation;
}
