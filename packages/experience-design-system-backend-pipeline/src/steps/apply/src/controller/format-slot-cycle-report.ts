import type { SlotCycle } from '../../../composition/src/types/graph.js';
import { formatSlotCycleReport as impl } from '../helpers/format-slot-cycle-report.js';

export interface FormatSlotCycleReportRequest {
  cycles: SlotCycle[];
}

export function formatSlotCycleReport(request: FormatSlotCycleReportRequest): string[] {
  return impl(request.cycles);
}
