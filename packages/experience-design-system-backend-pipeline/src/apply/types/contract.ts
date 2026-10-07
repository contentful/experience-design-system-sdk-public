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

export interface ApplyPreviewResult {
  type: 'preview';
  preview: ServerPreviewResponse;
  hasBreakingChanges: boolean;
}

export interface ApplySuccessResult {
  type: 'applied';
  operation: ApplyOperationResponse;
  spaceId: string;
  environmentId: string;
  host: string | undefined;
}

export interface ApplyNoChangesResult {
  type: 'no-changes';
}

export type ApplyEndpointResponse = ApplyPreviewResult | ApplySuccessResult | ApplyNoChangesResult;
