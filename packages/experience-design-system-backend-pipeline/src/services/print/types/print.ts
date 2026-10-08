export interface PrintComponentsRequest {
  sessionId?: string;
  allowEmpty?: boolean;
}

export interface PrintComponentsResult {
  cdf: Record<string, unknown>;
  componentCount: number;
  missingDescription: string[];
  generateStepFailed: boolean;
  sessionId: string;
}

export type PrintComponentsError =
  | { type: 'no-session'; command: 'generate components' }
  | { type: 'empty-rejected-no-allow'; rejectedCount: number; sessionId: string }
  | { type: 'empty'; sessionId: string };

export interface PrintTokensRequest {
  sessionId?: string;
}

export interface PrintTokensResult {
  tree: Record<string, unknown>;
  tokenCount: number;
  sessionId: string;
}

export type PrintTokensError =
  | { type: 'no-session'; command: 'generate tokens' }
  | { type: 'empty'; sessionId: string };
