import React, { createElement } from 'react';
import { ApiError, ImportApiClient } from '../api-client.js';
import { formatApiError } from '../../lib/error-parser.js';
import { exitWithAnalytics, failureFromApiError, recordApplyOutcome } from '../../analytics/index.js';
import type { CommandFailure } from '../../analytics/index.js';
import { ServerApplyProgress, ServerApplyDone } from '../tui/ServerApplyView.js';
import { buildApplyOutput } from '../helpers/apply-output-builders.js';
import type { ApplyOperationResponse, ServerPreviewResponse } from '@contentful/experience-design-system-types';

async function die(message: string, fields: CommandFailure = {}): Promise<never> {
  process.stderr.write(`${message}\n`);
  return exitWithAnalytics(1, fields);
}

function dieWithApiError(error: ApiError): Promise<never> {
  return die(`Error: ${formatApiError(error)}`, failureFromApiError(error));
}

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

interface ApplyAndPollOptions {
  acknowledgeBreakingChanges: boolean;
  onProgress?: (status: 'applying' | 'polling', operationId?: string) => void;
  onStarted?: (operationId: string) => void;
  onApiError: (error: ApiError) => Promise<void> | void;
}

async function applyAndPoll(
  client: ImportApiClient,
  cdf: Parameters<ImportApiClient['applyImport']>[0],
  options: ApplyAndPollOptions,
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

export interface NonInteractiveApplyOptions {
  client: ImportApiClient;
  cdf: Parameters<ImportApiClient['applyImport']>[0];
  spaceId: string;
  environmentId: string;
  host?: string;
  acknowledgeBreakingChanges: boolean;
}

export async function runNonInteractiveApply(options: NonInteractiveApplyOptions): Promise<void> {
  const operation = await applyAndPoll(options.client, options.cdf, {
    acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    onStarted: (operationId) => {
      process.stderr.write(`Apply operation started: ${operationId}\n`);
    },
    onApiError: (error) => dieWithApiError(error),
  });
  if (!operation) return;

  const summary = buildApplyOutput(operation, options.spaceId, options.environmentId, options.host);
  recordApplyOutcome(options.client, options.spaceId, options.environmentId, operation);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  await exitWithAnalytics(operation.sys.status === 'succeeded' ? 0 : 1);
}

export interface InteractiveApplyOptions {
  client: ImportApiClient;
  cdf: Parameters<ImportApiClient['applyImport']>[0];
  spaceId: string;
  environmentId: string;
  host?: string;
  acknowledgeBreakingChanges: boolean;
  rerender: (element: React.ReactElement) => void;
  onDone: () => void;
}

export async function runInteractiveApply(options: InteractiveApplyOptions): Promise<void> {
  const operation = await applyAndPoll(options.client, options.cdf, {
    acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    onProgress: (status, operationId) => {
      renderApplyProgress(options.rerender, options.spaceId, options.environmentId, status, { operationId });
    },
    onApiError: (error) => {
      renderApplyProgress(options.rerender, options.spaceId, options.environmentId, 'error', {
        error: formatApiError(error),
      });
    },
  });
  if (!operation) return;

  recordApplyOutcome(options.client, options.spaceId, options.environmentId, operation);
  options.rerender(
    createElement(ServerApplyDone, {
      operation,
      spaceId: options.spaceId,
      environmentId: options.environmentId,
      host: options.host,
    }),
  );
  options.onDone();
}

export type { ServerPreviewResponse };
