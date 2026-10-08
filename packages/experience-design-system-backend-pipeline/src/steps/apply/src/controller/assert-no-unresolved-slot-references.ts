import type { CDFComponentEntry } from '../../../shared/index.js';
import { validateSlotReferences } from '../../../shared/index.js';
import { formatUnresolvedSlotReferences } from '../helpers/format-unresolved-slot-references.js';

export interface AssertNoUnresolvedSlotReferencesRequest {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
}

/**
 * Pre-apply gate: throws if any slot `$allowedComponents` names a component
 * not present in the document.
 */
export function assertNoUnresolvedSlotReferences(request: AssertNoUnresolvedSlotReferencesRequest): void {
  const errors = validateSlotReferences(request.components);
  if (errors.length === 0) return;
  throw new Error(formatUnresolvedSlotReferences(errors).join('\n'));
}
