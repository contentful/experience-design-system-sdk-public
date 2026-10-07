import type { ApplyOperationResponse } from '../../../shared/types/index.js';
import type { WriteResult } from '../types/contract.js';

type OperationItem = NonNullable<ApplyOperationResponse['items']>[number];

function countByAction(items: OperationItem[]): WriteResult {
  return {
    createdCount: items.filter((i) => i.action === 'create' && i.status === 'succeeded').length,
    updatedCount: items.filter((i) => i.action === 'update' && i.status === 'succeeded').length,
    failedCount: items.filter((i) => i.status === 'failed').length,
  };
}

export function parseComponentWriteResult(operation: ApplyOperationResponse): WriteResult {
  const items = (operation.items ?? []).filter((i) => i.entityType === 'ComponentType');
  return countByAction(items);
}

export function parseTokenWriteResult(operation: ApplyOperationResponse): WriteResult | undefined {
  const items = (operation.items ?? []).filter((i) => i.entityType === 'DesignToken');
  if (items.length === 0) return undefined;
  return countByAction(items);
}
