import { warnOnUnknownPatchComponents as impl } from '../helpers/warn-on-unknown-patch-components.js';
import type { ComponentPatchOperation } from '../helpers/apply-component-patch.js';

export interface WarnOnUnknownPatchComponentsRequest<T extends { name: string }> {
  components: T[];
  operations: ComponentPatchOperation[];
}

export function warnOnUnknownPatchComponents<T extends { name: string }>(
  request: WarnOnUnknownPatchComponentsRequest<T>,
): string[] {
  return impl(request.components, request.operations);
}
