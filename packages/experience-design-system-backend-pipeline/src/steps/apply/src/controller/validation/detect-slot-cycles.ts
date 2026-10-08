import type { CDFComponentEntry } from '../../../../shared/index.js';
import type { SlotCycle } from '../../../../composition/src/types/graph.js';
import { detectSlotCycles as impl } from '../../helpers/detect-slot-cycles.js';

export interface DetectSlotCyclesRequest {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
}

export function detectSlotCycles(request: DetectSlotCyclesRequest): SlotCycle[] {
  return impl(request.components);
}
