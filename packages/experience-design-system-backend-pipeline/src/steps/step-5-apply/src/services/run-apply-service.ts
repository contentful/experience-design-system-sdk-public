import { buildCDF } from '../../../shared/types/index.js';
import type { ApplyOperationResponse } from '../../../shared/types/index.js';
import { createApiClient } from '../helpers/clients.js';
import { hasBreakingChangesWithImpact } from '../helpers/has-breaking-changes.js';
import { isEmptyPreview } from '../helpers/is-empty-preview.js';
import { parseComponentWriteResult, parseTokenWriteResult } from '../helpers/parse-write-result.js';
import { toCdfTokens } from '../helpers/token-utils.js';
import { ApiError } from '../types/api-error.js';
import type {
  ApplyEndpointRequest,
  ApplyEndpointResponse,
  ApplyNoChangesResult,
  ApplyPreviewResult,
  ApplySuccessResult,
} from '../types/contract.js';

export async function runApplyService(request: ApplyEndpointRequest): Promise<ApplyEndpointResponse> {
  const {
    components,
    tokens = [],
    credentials,
    previewOnly = false,
    acknowledgeBreakingChanges = false,
    onProgress,
  } = request;

  const cdf = buildCDF(components, toCdfTokens(tokens));
  if (!cdf) throw new Error('nothing to push — no components or tokens resolved');

  const client = createApiClient(credentials);

  onProgress?.('previewing');
  const preview = await client.previewImport(cdf);

  if (isEmptyPreview(preview)) {
    const result: ApplyNoChangesResult = {
      type: 'no-changes',
      xContentfulRequestId: client.getLastRequestId(),
    };
    return result;
  }

  if (previewOnly) {
    const result: ApplyPreviewResult = {
      type: 'preview',
      preview,
      hasBreakingChanges: hasBreakingChangesWithImpact(preview),
      xContentfulRequestId: client.getLastRequestId(),
    };
    return result;
  }

  onProgress?.('applying');
  const operation = await client.applyImport(cdf, { acknowledgeBreakingChanges });
  const operationId = operation.sys.id;

  onProgress?.('polling', operationId);
  const finalOperation = await client.pollOperation(operationId, {
    onProgress: (op: ApplyOperationResponse) => onProgress?.('polling', op.sys.id),
  });

  const result: ApplySuccessResult = {
    type: 'applied',
    operation: finalOperation,
    spaceId: credentials.spaceId,
    environmentId: credentials.environmentId,
    host: credentials.host,
    operationId,
    xContentfulRequestId: client.getLastRequestId(),
    componentWriteResult: parseComponentWriteResult(finalOperation),
    designTokenWriteResult: parseTokenWriteResult(finalOperation),
  };
  return result;
}

export { ApiError };
