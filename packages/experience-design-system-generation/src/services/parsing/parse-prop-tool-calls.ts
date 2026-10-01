import type {
  ClassifyPropCall,
  ClassifyComponentCall,
  ClassifySlotCall,
  ParsedToolCalls,
  ToolCall,
} from '../../types/tool-calls.js';
import { readToolCallObjects } from './helpers/read-tool-call-objects.js';

const VALID_TOOL_NAMES = new Set(['classify_prop', 'exclude_prop', 'classify_component', 'classify_slot']);
const VALID_CDF_TYPES = new Set(['string', 'richtext', 'media', 'enum', 'token', 'boolean']);
const VALID_CATEGORIES = new Set(['content', 'design', 'state']);

export function parsePropToolCallLines(stdout: string): ParsedToolCalls {
  const calls: ToolCall[] = [];
  const { objects, warnings } = readToolCallObjects(stdout);

  for (const rec of objects) {
    if (!VALID_TOOL_NAMES.has(rec.tool as string)) {
      warnings.push(`unknown tool: ${String(rec.tool)}`);
      continue;
    }

    const tool = rec.tool as ToolCall['tool'];

    if (tool === 'classify_prop') {
      if (typeof rec.prop !== 'string' || !rec.prop) {
        warnings.push('classify_prop missing prop name — skipped');
        continue;
      }
      if (typeof rec.cdf_type !== 'string' || !VALID_CDF_TYPES.has(rec.cdf_type)) {
        warnings.push(`classify_prop '${rec.prop}': invalid cdf_type '${String(rec.cdf_type)}' — skipped`);
        continue;
      }
      if (typeof rec.cdf_category !== 'string' || !VALID_CATEGORIES.has(rec.cdf_category)) {
        warnings.push(`classify_prop '${rec.prop}': invalid cdf_category '${String(rec.cdf_category)}' — skipped`);
        continue;
      }
      const call: ClassifyPropCall = {
        tool: 'classify_prop',
        prop: rec.prop,
        cdf_type: rec.cdf_type,
        cdf_category: rec.cdf_category as ClassifyPropCall['cdf_category'],
      };
      if (Array.isArray(rec.values) && rec.values.every((v) => typeof v === 'string'))
        call.values = rec.values as string[];
      if (typeof rec.token_kind === 'string') call.token_kind = rec.token_kind;
      if (typeof rec.required === 'boolean') call.required = rec.required;
      if (typeof rec.description === 'string') call.description = rec.description;
      if (typeof rec.default === 'string' || typeof rec.default === 'boolean') call.default = rec.default;
      if (typeof rec.reason === 'string') call.reason = rec.reason;
      calls.push(call);
    } else if (tool === 'exclude_prop') {
      if (typeof rec.prop !== 'string' || !rec.prop) {
        warnings.push('exclude_prop missing prop name — skipped');
        continue;
      }
      calls.push({
        tool: 'exclude_prop',
        prop: rec.prop,
        reason: typeof rec.reason === 'string' ? rec.reason : '',
      });
    } else if (tool === 'classify_component') {
      const call: ClassifyComponentCall = { tool: 'classify_component' };
      if (typeof rec.description === 'string') call.description = rec.description;
      if (typeof rec.rationale === 'object' && rec.rationale !== null) {
        const r = rec.rationale as Record<string, unknown>;
        const rationale: NonNullable<ClassifyComponentCall['rationale']> = {};
        if (typeof r.description === 'string') rationale.description = r.description;
        if (typeof r.props === 'string') rationale.props = r.props;
        if (typeof r.slots === 'string') rationale.slots = r.slots;
        if (Object.keys(rationale).length > 0) call.rationale = rationale;
      }
      calls.push(call);
    } else if (tool === 'classify_slot') {
      if (typeof rec.slot !== 'string' || !rec.slot) {
        warnings.push('classify_slot missing slot name — skipped');
        continue;
      }
      const call: ClassifySlotCall = { tool: 'classify_slot', slot: rec.slot };
      if (typeof rec.required === 'boolean') call.required = rec.required;
      if (Array.isArray(rec.allowed_components) && rec.allowed_components.every((v) => typeof v === 'string')) {
        call.allowed_components = rec.allowed_components as string[];
      }
      if (typeof rec.description === 'string') call.description = rec.description;
      if (typeof rec.rationale === 'string') call.rationale = rec.rationale;
      calls.push(call);
    }
  }

  return { calls, warnings };
}
