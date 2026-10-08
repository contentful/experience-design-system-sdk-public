import type { CDFComponentEntry } from '../../../../shared/index.js';
import { detectSlotCycles } from '../../helpers/detect-slot-cycles.js';
import { formatSlotCycleReport } from '../../helpers/format-slot-cycle-report.js';

export interface AssertNoSlotCyclesRequest {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
}

/**
 * Pre-apply gate: throws if any slot `$allowedComponents` chain contains a
 * cycle. Caller catches and renders the message (contains a multi-line
 * stderr-ready report).
 */
export function assertNoSlotCycles(request: AssertNoSlotCyclesRequest): void {
  const cycles = detectSlotCycles(request.components);
  if (cycles.length === 0) return;
  throw new Error(formatSlotCycleReport(cycles).join('\n'));
}
