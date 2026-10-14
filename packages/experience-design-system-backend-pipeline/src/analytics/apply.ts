import type { ApplyOperationResponse } from '@contentful/experience-design-system-types';
/** Minimal shape the analytics layer needs; accepts both bp's ApiClient and legacy's ImportApiClient. */
interface RequestIdCarrier {
  getLastRequestId(): string | undefined;
}
import { enrichCommandResult, setCommandContext } from './tracker.js';
import type { AnalyticsWriteResult } from './types.js';

function countWriteResult(
  items: NonNullable<ApplyOperationResponse['items']>,
  entityType: 'ComponentType' | 'DesignToken',
): AnalyticsWriteResult {
  const subset = items.filter((item) => item.entityType === entityType);
  return {
    created_count: subset.filter((item) => item.action === 'create' && item.status === 'succeeded').length,
    updated_count: subset.filter((item) => item.action === 'update' && item.status === 'succeeded').length,
    failed_count: subset.filter((item) => item.status === 'failed').length,
  };
}

/** Record apply/preview API outcomes on the active command. */
export function recordApplyOutcome(
  client: RequestIdCarrier,
  spaceId: string,
  environmentId: string,
  operation: ApplyOperationResponse,
): void {
  setCommandContext({
    space_key: spaceId,
    environment_key: environmentId,
    x_contentful_request_id: client.getLastRequestId(),
  });
  enrichCommandResult({
    dsi_operation_id: operation.sys.id,
    component_type_result: countWriteResult(operation.items ?? [], 'ComponentType'),
    design_token_result: countWriteResult(operation.items ?? [], 'DesignToken'),
  });
}

/** Record Contentful target context without an apply operation (e.g. preview-only). */
export function recordContentfulContext(client: RequestIdCarrier, spaceId: string, environmentId: string): void {
  setCommandContext({
    space_key: spaceId,
    environment_key: environmentId,
    x_contentful_request_id: client.getLastRequestId(),
  });
}
