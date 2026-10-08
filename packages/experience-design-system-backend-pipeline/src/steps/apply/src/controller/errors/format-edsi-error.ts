import { formatEdsiError as impl } from '../../helpers/edsi-errors/index.js';

export interface FormatEdsiErrorRequest {
  raw: unknown;
  verbose?: boolean;
  rawText?: string;
}

export function formatEdsiError(request: FormatEdsiErrorRequest): string {
  const { raw, verbose, rawText } = request;
  return impl(raw, {
    ...(verbose !== undefined ? { verbose } : {}),
    ...(rawText !== undefined ? { raw: rawText } : {}),
  });
}
