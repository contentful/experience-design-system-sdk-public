import type {
  ParsedSelectToolCalls,
  SelectComponentCall,
  SelectToolCall,
  RejectComponentCall,
} from '../../types/tool-calls.js';
import { parseSelectionSlotEvidence } from './helpers/parse-selection-slot-evidence.js';
import { readToolCallObjects } from './helpers/read-tool-call-objects.js';

const VALID_SELECT_TOOL_NAMES = new Set(['select_component', 'reject_component']);

export function parseSelectToolCallLines(stdout: string): ParsedSelectToolCalls {
  const calls: SelectToolCall[] = [];
  const { objects, warnings } = readToolCallObjects(stdout);

  for (const rec of objects) {
    if (!VALID_SELECT_TOOL_NAMES.has(rec.tool as string)) continue;

    if (typeof rec.name !== 'string' || !rec.name) {
      warnings.push(`${String(rec.tool)} missing name — skipped`);
      continue;
    }

    const call = {
      tool: rec.tool as SelectToolCall['tool'],
      name: rec.name,
    } as SelectToolCall;
    if (typeof rec.reason === 'string') (call as SelectComponentCall).reason = rec.reason;
    if (typeof rec.confidence === 'number' && rec.confidence >= 1 && rec.confidence <= 5) {
      if (call.tool === 'select_component') {
        (call as SelectComponentCall).confidence = rec.confidence;
      } else {
        (call as RejectComponentCall).confidence = rec.confidence;
      }
    }
    if (call.tool === 'select_component') {
      const slotEvidence = parseSelectionSlotEvidence(rec.slot_evidence, warnings);
      if (slotEvidence !== undefined) call.slot_evidence = slotEvidence;
    }
    calls.push(call);
  }

  return { calls, warnings };
}
