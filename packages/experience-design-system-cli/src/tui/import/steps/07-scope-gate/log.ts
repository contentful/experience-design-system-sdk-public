import type { ScopeComponent, ScopeDecisions } from './types.js';

// What the debug log says about the Scope gate. Only names and counts are stored. The point of the log is to show where
// the user's decision differs from the AI's suggestion, since that is where a component "goes missing".

// A big project must not make the log grow without bound.
const MAX_NAMES = 20;

const capped = (names: string[]): { count: number; names: string[] } => {
  const unique = [...new Set(names)];
  return { count: unique.length, names: unique.slice(0, MAX_NAMES) };
};

/** What the gate starts with: how many components, and what the AI suggested for them. */
export function scopeGateLogInputs(components: ScopeComponent[], tokenCount: number): Record<string, unknown> {
  const ai = { accepted: 0, rejected: 0, failed: 0, none: 0 };
  for (const component of components) ai[component.aiDecision ?? 'none'] += 1;
  return {
    components_found: components.length,
    ai_suggestions: ai,
    needs_review: components.filter((component) => component.needsReview === true).length,
    tokens: tokenCount,
  };
}

/**
 * What the user decided. Everything not accepted counts as rejected, so a component the AI accepted and the user never
 * touched shows as left out. Components with the same name share one decision, so names are counted once.
 */
export function scopeGateLogOutputs(components: ScopeComponent[], decisions: ScopeDecisions): Record<string, unknown> {
  const suggested = new Map(components.map((component) => [component.name, component.aiDecision]));
  return {
    outcome: 'continued',
    accepted: new Set(decisions.accepted).size,
    rejected: new Set(decisions.rejected).size,
    accepted_although_ai_rejected: capped(decisions.accepted.filter((name) => suggested.get(name) === 'rejected')),
    not_accepted_although_ai_accepted: capped(decisions.rejected.filter((name) => suggested.get(name) === 'accepted')),
  };
}
