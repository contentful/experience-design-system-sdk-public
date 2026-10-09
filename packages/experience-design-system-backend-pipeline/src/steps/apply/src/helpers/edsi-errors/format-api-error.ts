import { formatEdsiError } from './format-edsi-error.js';
import type { ApiErrorLike } from './types.js';

/** Format an `ApiError`-like for the user: phase prefix + parsed body + guidance. */
export function formatApiError(error: ApiErrorLike, verbose = false): string {
  const formatted = formatEdsiError(error.body || error.message, { verbose, raw: error.body }) || error.message;
  const phase = error.message.split('\n', 1)[0];
  const withPhase =
    /^(?:apply|preview|poll) failed: \d+$/.test(phase) && formatted !== phase ? `${phase}\n${formatted}` : formatted;
  return error.guidance ? `${withPhase}\n${error.guidance}` : withPhase;
}
