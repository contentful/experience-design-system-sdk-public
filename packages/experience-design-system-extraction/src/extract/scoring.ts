import type { RawComponentDefinition } from '../types.js';

// 1 = very low confidence (likely wrong), 5 = very high confidence (clearly correct)
export type ExtractionConfidence = 1 | 2 | 3 | 4 | 5;

export type ExtractionScore = {
  confidence: ExtractionConfidence;
  reasons: string[];
};

export interface ExtractionScoreOptions {
  additionalIssueCount?: number;
  additionalReasons?: string[];
}

// Prop type strings that indicate the extractor couldn't resolve a concrete type
const OPAQUE_TYPES = new Set(['any', 'unknown', 'object', 'Record<string, unknown>', 'Record<string, any>']);

// Prop names that are non-obvious and benefit from a description
const OBVIOUS_PROP_NAMES = new Set([
  'className',
  'style',
  'id',
  'children',
  'disabled',
  'hidden',
  'onClick',
  'onChange',
  'onSubmit',
  'onBlur',
  'onFocus',
  'href',
  'src',
  'alt',
  'type',
  'value',
  'checked',
  'placeholder',
  'label',
  'title',
  'name',
  'required',
  'readOnly',
  'autoFocus',
  'tabIndex',
  'role',
  'aria-label',
  'aria-describedby',
]);

// A union is "wide" if it mixes 3+ distinct base primitive types (ignoring nullability modifiers).
// e.g. "string | number | boolean" → wide. "string | null | undefined" → NOT wide (just nullable string).
function isWidePrimitiveUnion(type: string): boolean {
  const parts = type.split('|').map((p) => p.trim());
  if (parts.length < 3) return false;
  const basePrimitives = new Set(['string', 'number', 'boolean']);
  const nullability = new Set(['null', 'undefined']);
  const baseCount = parts.filter((p) => basePrimitives.has(p)).length;
  const nullabilityCount = parts.filter((p) => nullability.has(p)).length;
  return baseCount >= 3 || (baseCount >= 2 && nullabilityCount > 0 && baseCount + nullabilityCount >= 3);
}

// Count the number of issues found for scoring
function countIssues(
  component: RawComponentDefinition,
  options: ExtractionScoreOptions = {},
): { count: number; reasons: string[] } {
  let count = 0;
  const reasons: string[] = [];

  if (component.props.length === 0 && component.slots.length === 0) {
    count++;
    reasons.push('no-props-or-slots');
  }

  if (component.props.length > 50) {
    count++;
    reasons.push(`high-prop-count:${component.props.length}`);
  }

  for (const prop of component.props) {
    if (OPAQUE_TYPES.has(prop.type.trim())) {
      count++;
      reasons.push(`opaque-type:${prop.name}`);
      break;
    }
    if (isWidePrimitiveUnion(prop.type)) {
      count++;
      reasons.push(`wide-union:${prop.name}`);
      break;
    }
    if (!prop.description && !OBVIOUS_PROP_NAMES.has(prop.name)) {
      count++;
      reasons.push('props-missing-description');
      break;
    }
  }

  count += options.additionalIssueCount ?? 0;
  if (options.additionalReasons && options.additionalReasons.length > 0) {
    reasons.push(...options.additionalReasons);
  }

  return { count, reasons: [...new Set(reasons)] };
}

// Maps issue count to a 1–5 confidence scale:
//   0 issues → 5 (clean)
//   1 issue  → 4 (minor concern)
//   2 issues → 3 (moderate concern)
//   3 issues → 2 (significant concern)
//   4+ issues → 1 (likely wrong)
function issueCountToConfidence(count: number): ExtractionConfidence {
  if (count === 0) return 5;
  if (count === 1) return 4;
  if (count === 2) return 3;
  if (count === 3) return 2;
  return 1;
}

export function computeExtractionScore(
  component: RawComponentDefinition,
  options: ExtractionScoreOptions = {},
): ExtractionScore {
  const { count, reasons } = countIssues(component, options);
  return {
    confidence: issueCountToConfidence(count),
    reasons,
  };
}

// Flag components scoring 2 or below for human review
export function deriveNeedsReview(confidence: ExtractionConfidence): boolean {
  return confidence <= 2;
}
