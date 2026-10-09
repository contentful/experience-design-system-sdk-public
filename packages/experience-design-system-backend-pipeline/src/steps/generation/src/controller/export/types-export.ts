export interface ExportCdfDocumentRequest {
  sessionId?: string;
  allowEmpty?: boolean;
}

export interface ExportCdfDocumentResult {
  cdf: Record<string, unknown>;
  componentCount: number;
  missingDescription: string[];
  generateStepFailed: boolean;
  sessionId: string;
}

export type ExportCdfDocumentError =
  | { type: 'no-session'; command: 'generate components' }
  | { type: 'empty-rejected-no-allow'; rejectedCount: number; sessionId: string }
  | { type: 'empty'; sessionId: string };

export interface ExportDtcgTreeRequest {
  sessionId?: string;
}

export interface ExportDtcgTreeResult {
  tree: Record<string, unknown>;
  tokenCount: number;
  sessionId: string;
}

export type ExportDtcgTreeError =
  | { type: 'no-session'; command: 'generate tokens' }
  | { type: 'empty'; sessionId: string };

// Legacy-name aliases.
export type PrintComponentsRequest = ExportCdfDocumentRequest;
export type PrintComponentsResult = ExportCdfDocumentResult;
export type PrintComponentsError = ExportCdfDocumentError;
export type PrintTokensRequest = ExportDtcgTreeRequest;
export type PrintTokensResult = ExportDtcgTreeResult;
export type PrintTokensError = ExportDtcgTreeError;
