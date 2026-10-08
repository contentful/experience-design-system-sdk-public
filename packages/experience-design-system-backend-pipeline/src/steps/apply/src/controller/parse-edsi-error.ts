import { parseEdsiError as impl } from '../helpers/edsi-errors/index.js';
import type { ParsedEdsiError } from '../helpers/edsi-errors/index.js';

export type { ParsedEdsiError };

export interface ParseEdsiErrorRequest {
  body: string | undefined | null;
}

export function parseEdsiError(request: ParseEdsiErrorRequest): ParsedEdsiError {
  return impl(request.body);
}
