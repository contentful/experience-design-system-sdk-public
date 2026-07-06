import type { ScopeComponent } from './steps/ScopeGateStep.js';

// INTEG-4318: overlay streamed auto-filter decisions (from the select-agent
// child's stderr progress lines) onto components loaded from raw_components.
// Only fills gaps where the DB has no decision — the DB row is authoritative
// once the child persists its status. This is what lets the scope-gate see
// a 'failed' status for components where the LLM omitted a tool call in a
// batch (the select-agent does not persist a 'failed' status to the DB).
export function mergeAiDecisions(
  components: ReadonlyArray<ScopeComponent>,
  aiDecisions: Record<string, { decision: 'accepted' | 'rejected' | 'failed'; reason: string }>,
): ScopeComponent[] {
  return components.map((component) => {
    if (component.aiDecision !== null && component.aiDecision !== undefined) {
      return component;
    }
    const streamed = aiDecisions[component.name];
    if (!streamed) {
      return component;
    }
    return {
      ...component,
      aiDecision: streamed.decision,
      aiReason: streamed.reason,
    };
  });
}
