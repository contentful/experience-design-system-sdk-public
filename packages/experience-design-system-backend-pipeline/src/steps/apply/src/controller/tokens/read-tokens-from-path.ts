import type { DTCGTokenEntry } from '../../../../shared/index.js';
import { readTokensFromPath as impl } from '../../helpers/tokens/read-tokens-from-path.js';

export interface ReadTokensFromPathRequest {
  /** CLI flag the path came from (used in error messages). */
  flag: string;
  /** Absolute or relative path to a `.json` file or directory of `.json` files. */
  path: string;
}

export function readTokensFromPath(request: ReadTokensFromPathRequest): Promise<DTCGTokenEntry[]> {
  return impl(request.flag, request.path);
}
