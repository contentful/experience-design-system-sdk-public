import type {
  CDFComponentEntry,
  DTCGTokenEntry,
  ServerPreviewResponse,
  ApplyOperationResponse,
} from '@contentful/experience-design-system-types';

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
  components: CDFComponentEntry[];
  tokens?: DTCGTokenEntry[];
  credentials: ApplyCredentials;
  previewOnly?: boolean;
  acknowledgeBreakingChanges?: boolean;
}

export interface WriteResult {
  createdCount: number;
  updatedCount: number;
  failedCount: number;
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
