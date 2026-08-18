import type { ApiError } from '../apply/api-client.js';
import { flushAnalytics } from './client.js';
import { completeActiveCommand, failActiveCommand } from './tracker.js';
import type { CommandFailure } from './types.js';

export async function exitWithAnalytics(code: number, fields: CommandFailure = {}): Promise<never> {
  if (code === 0) await completeActiveCommand();
  else await failActiveCommand({ exit_code: code, ...fields });
  await flushAnalytics();
  process.exit(code);
}

export function failureFromApiError(error: ApiError): CommandFailure {
  return {
    error_name: error.name,
    http_status_code: error.status,
    exit_code: 1,
  };
}

export function failureFromUnknown(error: unknown): CommandFailure {
  if (error instanceof Error) {
    return { error_name: error.name, exit_code: 1 };
  }
  return { error_name: 'Error', exit_code: 1 };
}
