import type {
  CDFComponentEntry,
  DTCGTokenEntry,
  ServerPreviewResponse,
  ApplyOperationResponse,
} from '../../../shared/index.js';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep: (delayMs: number) => Promise<void>;
}

export type PostPushView = 'components' | 'design_tokens';

export interface BuildPostPushUrlInput {
  host: string;
  spaceId: string;
  environmentId: string;
  view?: PostPushView;
}

export interface ApplyCredentials {
  accessToken: string;
  spaceId: string;
  environmentId: string;
  host?: string;
}

export interface ApplyEndpointRequest {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens?: DTCGTokenEntry[];
  credentials: ApplyCredentials;
  previewOnly?: boolean;
  acknowledgeBreakingChanges?: boolean;
  onProgress?: (status: 'previewing' | 'applying' | 'polling', operationId?: string) => void;
}

export interface WriteResult {
  createdCount: number;
  updatedCount: number;
  failedCount: number;
}

export interface ApiClientOptions {
  host?: string;
  cmaToken: string;
  spaceId: string;
  environmentId: string;
  retry?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  };
}

export interface PreviewValidationError {
  componentName: string;
  path: string;
  message: string;
}

export interface ApplyPreviewResult {
  type: 'preview';
  preview: ServerPreviewResponse;
  hasBreakingChanges: boolean;
  xContentfulRequestId?: string;
}

export interface ApplySuccessResult {
  type: 'applied';
  operation: ApplyOperationResponse;
  spaceId: string;
  environmentId: string;
  host: string | undefined;
  operationId: string;
  xContentfulRequestId?: string;
  componentWriteResult: WriteResult;
  designTokenWriteResult?: WriteResult;
}

export interface ApplyNoChangesResult {
  type: 'no-changes';
  xContentfulRequestId?: string;
}

export type ApplyEndpointResponse = ApplyPreviewResult | ApplySuccessResult | ApplyNoChangesResult;
