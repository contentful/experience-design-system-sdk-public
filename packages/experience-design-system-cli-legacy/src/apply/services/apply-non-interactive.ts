import { ApiError, ImportApiClient } from '../api-client.js';
import { formatApiError } from '../../lib/error-parser.js';
import { exitWithAnalytics, failureFromApiError, recordApplyOutcome } from '../../analytics/index.js';
import type { CommandFailure } from '../../analytics/index.js';
import { buildApplyOutput } from '../helpers/build-apply-output.js';
import { pollApplyOperation } from '../helpers/poll-apply-operation.js';

async function die(message: string, fields: CommandFailure = {}): Promise<never> {
  process.stderr.write(`${message}\n`);
  return exitWithAnalytics(1, fields);
}

export interface ApplyNonInteractiveOptions {
  client: ImportApiClient;
  cdf: Parameters<ImportApiClient['applyImport']>[0];
  spaceId: string;
  environmentId: string;
  host?: string;
  acknowledgeBreakingChanges: boolean;
}

export async function applyNonInteractive(options: ApplyNonInteractiveOptions): Promise<void> {
  const operation = await pollApplyOperation(options.client, options.cdf, {
    acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    onStarted: (operationId) => {
      process.stderr.write(`Apply operation started: ${operationId}\n`);
    },
    onApiError: (error: ApiError) => die(`Error: ${formatApiError(error)}`, failureFromApiError(error)),
  });
  if (!operation) return;

  const summary = buildApplyOutput(operation, options.spaceId, options.environmentId, options.host);
  recordApplyOutcome(options.client, options.spaceId, options.environmentId, operation);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  await exitWithAnalytics(operation.sys.status === 'succeeded' ? 0 : 1);
}
