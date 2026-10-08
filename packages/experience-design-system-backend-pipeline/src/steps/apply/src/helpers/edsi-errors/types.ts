export interface ErrorDiagnostic {
  message: string;
  component?: string;
  /** `null` means the API supplied a location but it had no usable segments. */
  path?: string | null;
  messageSource?: 'message' | 'details' | 'error' | 'name';
}

export interface ParsedEdsiError {
  /** Server-side error code if extractable. */
  code: string | null;
  /** Human-readable message, log/trace decoration stripped. */
  message: string;
  /** Cycle participants when `code === 'TopoSortCycleError'`. */
  cycle: string[] | null;
  /** True when the message passed through cleaning without any parseable structure. */
  raw: boolean;
  /** Validation details supplied by the API, normalized for terminal output. */
  diagnostics?: ErrorDiagnostic[];
}

export interface ApiErrorLike {
  body?: string;
  guidance?: string;
  message: string;
}
