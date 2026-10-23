import type { NodeStatus } from '../graph/composite-closure.js';

export type PreviewAnnotation = 'new' | 'changed' | 'removed' | 'breaking';

export interface RenderStatus {
  status: NodeStatus;
  isOwn: boolean;
  sourceComponents: string[];
}
