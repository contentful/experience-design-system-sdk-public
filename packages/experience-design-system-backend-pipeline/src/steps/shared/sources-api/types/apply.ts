export type ApplyOperationStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export interface ApplyOperationItemError {
  code: string;
  message: string;
}

export interface ApplyOperationItem {
  entityType: 'ComponentType' | 'DesignToken';
  id: string;
  action: 'create' | 'update' | 'delete';
  status: 'queued' | 'succeeded' | 'failed';
  error?: string | ApplyOperationItemError;
}

export interface ApplyOperationResponse {
  sys: {
    type: 'ApplyOperation';
    id: string;
    status: ApplyOperationStatus;
    createdAt: string;
    createdBy: { sys: { type: 'Link'; linkType: string; id: string } };
  };
  summary: {
    total: number;
    pending: number;
    succeeded: number;
    failed: number;
  };
  items?: ApplyOperationItem[];
}

export interface ApplyGateError {
  sys: { type: 'Error'; id: string };
  message: string;
  details?: {
    breakingComponentIds?: string[];
    affectedEntities?: number;
    errors?: Array<{ path: string; message: string }>;
  };
}
