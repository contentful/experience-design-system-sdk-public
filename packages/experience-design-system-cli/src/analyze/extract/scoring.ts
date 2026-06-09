import type { RawComponentDefinition } from '../../types.js';

export type ExtractionScore = {
  confidence: number; // 0–100
  reasons: string[];
};

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
  // Wide only when there are 3+ base primitives, or 2+ base primitives combined with nullability modifiers
  return baseCount >= 3 || (baseCount >= 2 && nullabilityCount > 0 && baseCount + nullabilityCount >= 3);
}

export function computeExtractionScore(component: RawComponentDefinition): ExtractionScore {
  let confidence = 100;
  const reasons: string[] = [];

  // No props and no slots — extractor likely missed something or component is a wrapper
  if (component.props.length === 0 && component.slots.length === 0) {
    confidence -= 15;
    reasons.push('no-props-or-slots');
  }

  for (const prop of component.props) {
    // Opaque types — extractor couldn't resolve the real type
    if (OPAQUE_TYPES.has(prop.type.trim())) {
      confidence -= 20;
      reasons.push(`opaque-type:${prop.name}`);
      break; // only penalise once per component
    }

    // Wide primitive union — hard for the AI agent to classify meaningfully
    if (isWidePrimitiveUnion(prop.type)) {
      confidence -= 10;
      reasons.push(`wide-union:${prop.name}`);
      break; // only penalise once
    }

    // Non-obvious prop name with no description
    if (!prop.description && !OBVIOUS_PROP_NAMES.has(prop.name)) {
      confidence -= 10;
      reasons.push('props-missing-description');
      break; // only penalise once
    }
  }

  // High prop count — possible DOM inflation near-miss or overly broad extraction
  if (component.props.length > 50) {
    confidence -= 20;
    reasons.push(`high-prop-count:${component.props.length}`);
  }

  return {
    confidence: Math.max(0, Math.min(100, confidence)),
    reasons: [...new Set(reasons)], // deduplicate
  };
}

export function deriveNeedsReview(confidence: number): boolean {
  return confidence < 70;
}
