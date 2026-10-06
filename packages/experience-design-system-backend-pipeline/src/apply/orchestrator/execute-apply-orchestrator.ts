import type { ApplyEndpointRequest, ApplyEndpointResponse } from '../types/contract.js';

// TODO (INTEG-5027): move apply services from cli-legacy/src/apply/ into this domain.
// Needed: api-client, services/apply-non-interactive, services/apply-interactive,
// helpers/poll-apply-operation, helpers/read-token-files, helpers/slot-validation.
// These require decoupling from CLI internals (analytics, process.exit, TUI).

export async function executeApplyOrchestrator(
  _request: ApplyEndpointRequest,
): Promise<ApplyEndpointResponse> {
  throw new Error('executeApplyOrchestrator not yet implemented — see INTEG-5027');
}
