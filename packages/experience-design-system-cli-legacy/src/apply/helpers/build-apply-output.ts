import type { ApplyOperationResponse, ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { buildPostPushUrl } from '../../lib/contentful-urls.js';
import { formatEdsiError } from '../../lib/error-parser.js';

export function buildPreviewOutput(preview: ServerPreviewResponse, spaceId: string, environmentId: string) {
  return {
    spaceId,
    environmentId,
    components: {
      new: preview.components.new.length,
      changed: preview.components.changed.length,
      unchanged: preview.components.unchanged.length,
      removed: preview.components.removed.length,
      breaking: preview.components.changed.filter((c) => c.changeClassification?.classification === 'breaking').length,
      draftOverwrites: preview.components.changed.filter((c) => c.hasPendingDraftChanges).length,
    },
    tokens: {
      new: preview.tokens.new.length,
      changed: preview.tokens.changed.length,
      unchanged: preview.tokens.unchanged.length,
      removed: preview.tokens.removed.length,
      draftOverwrites: preview.tokens.changed.filter((c) => c.hasPendingDraftChanges).length,
    },
    taxonomies: {
      new: preview.taxonomies.new.length,
      changed: preview.taxonomies.changed.length,
      unchanged: preview.taxonomies.unchanged.length,
      removed: preview.taxonomies.removed.length,
    },
  };
}

export function buildApplyOutput(
  operation: ApplyOperationResponse,
  spaceId: string,
  environmentId: string,
  host: string | undefined,
) {
  const items = operation.items ?? [];
  const componentItems = items.filter((i) => i.entityType === 'ComponentType');
  const tokenItems = items.filter((i) => i.entityType === 'DesignToken');
  const countByAction = (subset: typeof items) => ({
    created: subset.filter((i) => i.action === 'create' && i.status === 'succeeded').length,
    updated: subset.filter((i) => i.action === 'update' && i.status === 'succeeded').length,
    failed: subset.filter((i) => i.status === 'failed').length,
  });

  return {
    status: operation.sys.status,
    operationId: operation.sys.id,
    spaceId,
    environmentId,
    summary: operation.summary,
    componentTypes: countByAction(componentItems),
    designTokens: countByAction(tokenItems),
    viewUrl: buildPostPushUrl({ host: host ?? 'api.contentful.com', spaceId, environmentId }),
    tokensUrl: buildPostPushUrl({ host: host ?? 'api.contentful.com', spaceId, environmentId, view: 'design_tokens' }),
    failures: items
      .filter((item) => item.status === 'failed')
      .map((item) => ({
        entityType: item.entityType,
        entityId: item.id,
        error: formatEdsiError(item.error),
      })),
  };
}
