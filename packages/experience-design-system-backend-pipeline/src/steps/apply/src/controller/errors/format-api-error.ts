import { formatApiError as impl, type ApiErrorLike } from '../../helpers/edsi-errors/index.js';

export type { ApiErrorLike };

export interface FormatApiErrorRequest {
  error: ApiErrorLike;
  verbose?: boolean;
}

export function formatApiError(request: FormatApiErrorRequest): string {
  return impl(request.error, request.verbose ?? false);
}
