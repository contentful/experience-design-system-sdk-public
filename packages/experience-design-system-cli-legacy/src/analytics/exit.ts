import {
  completeActiveCommand,
  failActiveCommand,
  flushAnalytics,
  type CommandFailure,
} from '@contentful/experience-design-system-backend-pipeline';
import type { ApiError } from '../apply/api-client.js';

export async function exitWithAnalytics(code: number, fields: CommandFailure = {}): Promise<never> {
  if (code === 0) await completeActiveCommand();
  else await failActiveCommand({ exit_code: code, ...fields });
  await flushAnalytics();
  process.exit(code);
  throw new Error('unreachable');
}

export function failureFromApiError(error: ApiError): CommandFailure {
  return {
    error_name: error.name,
    http_status_code: error.status,
    exit_code: 1,
  };
}
