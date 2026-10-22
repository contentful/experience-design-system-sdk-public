import { CDF_PROPERTY_TYPES } from '../cdf/vocabularies.js';
import { parseClassificationMetadata, type ClassifiedPropertyCall } from './classification.js';
import { cloneJson, jsonValueIssue, parseStrictJson, own } from './json-value.js';
import { validateProposalDraft } from './representation-proposal.js';
import { isSourceBoundRepresentation } from './source-representation.js';
import { validateNullHandling } from './null-handling.js';

export interface ComponentClassificationCall {
  tool: 'classify_component';
  description?: string;
  rationale?: { description?: string; props?: string; slots?: string };
}
export interface SlotClassificationCall {
  tool: 'classify_slot';
  slot: string;
  required?: boolean;
  allowed_components?: string[];
  description?: string;
  rationale?: string;
}
export interface PropertyExclusionCall {
  tool: 'exclude_prop';
  prop: string;
  reason: string;
}
export type ClassificationToolCall =
  | ClassifiedPropertyCall
  | ComponentClassificationCall
  | SlotClassificationCall
  | PropertyExclusionCall;
export interface NormalizedClassificationCalls {
  calls: ClassificationToolCall[];
  warnings: string[];
}
const fields = {
  classify_component: ['description', 'rationale'],
  classify_slot: ['slot', 'required', 'allowed_components', 'description', 'rationale'],
  exclude_prop: ['prop', 'reason'],
  classify_prop: [
    'prop',
    'cdf_type',
    'cdf_category',
    'values',
    'token_kind',
    'required',
    'description',
    'default',
    'default_intent',
    'items',
    'fields',
    'source_revision',
    'source_node_id',
    'reason',
    'value',
    'valueType',
    'discriminator',
    'members',
    'allowedResources',
    'representation_proposal',
    'null_handling',
  ],
} as const;

/** Wire and direct calls use the same descriptor-checked normalization. */
export function normalizeClassificationCalls(values: readonly unknown[]): NormalizedClassificationCalls {
  const outerIssue = jsonValueIssue(values);
  if (outerIssue) return { calls: [], warnings: [`${outerIssue.path}: ${outerIssue.message}`] };
  const calls: ClassificationToolCall[] = [];
  const warnings: string[] = [];
  for (const [index, value] of values.entries()) {
    try {
      const unsafe = jsonValueIssue(value);
      if (unsafe) throw new Error(`${unsafe.path}: ${unsafe.message}`);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected tool object');
      const rec = value as Record<string, unknown>;
      if (typeof rec.tool !== 'string' || !own(fields, rec.tool)) throw new Error('Unknown tool');
      const tool = rec.tool as keyof typeof fields;
      const allowed: readonly string[] = fields[tool];
      if (Object.keys(rec).some((key) => key !== 'tool' && !allowed.includes(key)))
        throw new Error('Unknown decision field');
      for (const key of ['prop', 'slot', 'description', 'reason', 'token_kind', 'source_revision', 'source_node_id'])
        if (own(rec, key) && typeof rec[key] !== 'string') throw new Error(`${key} must be a string`);
      if (own(rec, 'required') && typeof rec.required !== 'boolean') throw new Error('required must be Boolean');
      if (tool === 'classify_prop' || tool === 'exclude_prop')
        if (typeof rec.prop !== 'string' || !rec.prop) throw new Error('Missing exact property name');
      if (tool === 'exclude_prop' && (typeof rec.reason !== 'string' || !rec.reason.trim()))
        throw new Error('Exclusion requires nonblank reason');
      if (tool === 'classify_slot') {
        if (typeof rec.slot !== 'string' || !rec.slot) throw new Error('Missing exact slot name');
        if (own(rec, 'rationale') && typeof rec.rationale !== 'string') throw new Error('rationale must be a string');
        if (
          own(rec, 'allowed_components') &&
          (!Array.isArray(rec.allowed_components) ||
            !rec.allowed_components.every((entry) => typeof entry === 'string') ||
            new Set(rec.allowed_components).size !== rec.allowed_components.length)
        )
          throw new Error('Invalid allowed components');
      }
      if (tool === 'classify_component' && own(rec, 'rationale')) {
        const rationale = rec.rationale;
        if (
          !rationale ||
          typeof rationale !== 'object' ||
          Array.isArray(rationale) ||
          Object.entries(rationale).some(
            ([key, entry]) => !['description', 'props', 'slots'].includes(key) || typeof entry !== 'string',
          )
        )
          throw new Error('Invalid component rationale');
      }
      const call = cloneJson(rec) as unknown as ClassificationToolCall;
      if (call.tool === 'classify_prop') {
        if (!['content', 'design', 'state'].includes(call.cdf_category)) throw new Error('Invalid semantic category');
        if (own(rec, 'null_handling')) {
          const issues = validateNullHandling(rec.null_handling);
          if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
          if (!call.source_revision?.trim() || !call.source_node_id?.trim())
            throw new Error('Null handling requires the current source revision and property root node');
        }
        if (own(rec, 'cdf_type')) {
          if (typeof rec.cdf_type !== 'string' || !(CDF_PROPERTY_TYPES as readonly string[]).includes(rec.cdf_type))
            throw new Error('Invalid representation type');
          if (own(rec, 'token_kind') && rec.cdf_type !== 'token')
            throw new Error('Token kind requires token representation');
          if (own(rec, 'values') && rec.cdf_type === 'token')
            throw new Error('Token options require a token mapping decision');
          const issues = parseClassificationMetadata(rec, call);
          if (issues.length) throw new Error(issues.join('; '));
          if (own(rec, 'representation_proposal')) {
            const issues = validateProposalDraft(call.representation_proposal);
            if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
            if (
              !call.representation_proposal ||
              call.representation_proposal.desiredType !== call.cdf_type ||
              call.cdf_category !== 'content' ||
              call.representation_proposal.key !== call.prop ||
              call.representation_proposal.name !== call.prop
            )
              throw new Error('Representation proposal and property decision disagree');
          }
          if (isSourceBoundRepresentation(call.cdf_type!) && !call.representation_proposal)
            throw new Error('Source-bound representation requires a complete proposal');
        } else {
          if (typeof call.reason !== 'string' || !call.reason.trim())
            throw new Error('Absent representation requires nonblank reason');
          if (
            [
              'values',
              'token_kind',
              'default',
              'default_intent',
              'items',
              'fields',
              'required',
              'value',
              'valueType',
              'discriminator',
              'members',
              'allowedResources',
              'representation_proposal',
              'null_handling',
            ].some((key) => own(rec, key))
          )
            throw new Error('Representation companions require a representation');
        }
      }
      calls.push(call);
    } catch (error) {
      warnings.push(`decision ${index + 1}: ${error instanceof Error ? error.message : 'Invalid decision'}`);
    }
  }
  const keys = calls.map((call) =>
    call.tool === 'classify_component'
      ? 'component'
      : call.tool === 'classify_slot'
        ? `slot:${call.slot}`
        : `property:${call.prop}`,
  );
  const duplicates = new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
  for (const key of duplicates) warnings.push(`Duplicate or conflicting subject ${key}`);
  return { calls: calls.filter((_, index) => !duplicates.has(keys[index]!)), warnings };
}

export function parseClassificationToolLines(stdout: string): NormalizedClassificationCalls {
  const values: unknown[] = [];
  const warnings: string[] = [];
  for (const [index, raw] of stdout.split('\n').entries()) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      values.push(parseStrictJson(line));
    } catch {
      warnings.push(`line ${index + 1}: malformed JSON or trailing content`);
    }
  }
  const normalized = normalizeClassificationCalls(values);
  return { calls: normalized.calls, warnings: [...warnings, ...normalized.warnings] };
}

export interface DecisionInventory {
  properties: readonly string[];
  slots: readonly { name: string; sourceInput?: string }[];
}
export interface DecisionAccounting {
  complete: boolean;
  accepted: ClassificationToolCall[];
  missing: string[];
  issues: string[];
}
export function accountClassificationCalls(
  inventory: DecisionInventory,
  calls: readonly ClassificationToolCall[],
): DecisionAccounting {
  const issues: string[] = [];
  const subjects = [
    'component',
    ...inventory.properties.map((key) => `property:${key}`),
    ...inventory.slots.map((slot) => `slot:${slot.name}`),
  ];
  if (new Set(subjects).size !== subjects.length) issues.push('Duplicate retained source subject');
  const owners = inventory.slots.flatMap((slot) => (slot.sourceInput === undefined ? [] : [slot.sourceInput]));
  if (new Set(owners).size !== owners.length) issues.push('Competing accepted slot owners');
  if (owners.some((key) => inventory.properties.includes(key)))
    issues.push('Property and slot compete for source owner');
  const grouped = new Map<string, ClassificationToolCall[]>();
  for (const call of calls) {
    const key =
      call.tool === 'classify_component'
        ? 'component'
        : call.tool === 'classify_slot'
          ? `slot:${call.slot}`
          : `property:${call.prop}`;
    const entries = grouped.get(key) ?? [];
    entries.push(call);
    grouped.set(key, entries);
  }
  const accepted: ClassificationToolCall[] = [];
  for (const [key, entries] of grouped) {
    if (!subjects.includes(key)) issues.push(`Unknown subject ${key}`);
    else if (entries.length !== 1) issues.push(`Duplicate or conflicting subject ${key}`);
    else accepted.push(entries[0]!);
  }
  const missing = subjects.filter((key) => grouped.get(key)?.length !== 1);
  return { complete: !issues.length && !missing.length, accepted, missing, issues };
}
