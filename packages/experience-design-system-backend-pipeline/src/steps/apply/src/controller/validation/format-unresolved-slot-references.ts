import type { CDFValidationError } from '../../../../shared/index.js';
import { formatUnresolvedSlotReferences as impl } from '../../helpers/format-unresolved-slot-references.js';

export interface FormatUnresolvedSlotReferencesRequest {
  errors: CDFValidationError[];
}

export function formatUnresolvedSlotReferences(request: FormatUnresolvedSlotReferencesRequest): string[] {
  return impl(request.errors);
}
