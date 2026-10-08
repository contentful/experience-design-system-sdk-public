import { groupNodesByCycleMembership as impl } from '../../helpers/cycles/group-nodes-by-cycle-membership.js';
import type { SlotCycle } from '../../types/graph.js';

export interface GroupNodesByCycleMembershipRequest {
  cycles: SlotCycle[];
}

export function groupNodesByCycleMembership(request: GroupNodesByCycleMembershipRequest): Map<string, Set<string>> {
  return impl(request.cycles);
}
