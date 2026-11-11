import { repeatedNames } from '../../shared/component-facts.js';
import { nameLines, nameList } from '../../shared/entity-lists.js';
import type { ScopeComponent, ScopeDecisions } from './types.js';

// What the debug log says about the Scope gate. It names the components: the ones the user accepted, the ones they left
// out, and above all where their decision differs from the AI's suggestion, since that is where a component "goes
// missing". The lists are cut (see `entity-lists`); the counts are always the full counts.

/**
 * The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. `decisions` is null when
 * the user left without deciding. Everything not accepted counts as rejected, so a component the AI accepted and the user
 * never touched shows as left out. Components with the same name share one decision, so names are counted once.
 */
export function scopeGateLog({
  components,
  tokenCount,
  decisions,
}: {
  components: ScopeComponent[];
  tokenCount: number;
  decisions: ScopeDecisions | null;
}): { summary: string[]; data: Record<string, unknown> } {
  const ai = { accepted: 0, rejected: 0, failed: 0, none: 0 };
  for (const component of components) ai[component.aiDecision ?? 'none'] += 1;
  const needsReview = components.filter((component) => component.needsReview === true).length;
  const repeated = nameList(repeatedNames(components.map((component) => component.name)));

  const different = new Set(components.map((component) => component.name)).size;
  const summary = [
    `Components found: ${components.length}${different === components.length ? '' : ` (${different} different names)`}`,
    `The AI suggested: ${ai.accepted} accept, ${ai.rejected} reject, ${ai.failed} failed, ${ai.none} no suggestion`,
    `Needing review: ${needsReview}`,
    `Tokens in the project: ${tokenCount}`,
    ...nameLines('Found more than once (they share one decision)', repeated),
  ];
  const data: Record<string, unknown> = {
    components_found: components.length,
    ai_suggestions: ai,
    needs_review: needsReview,
    tokens: tokenCount,
    found_more_than_once: repeated,
  };

  if (decisions === null) {
    summary.push('Outcome: left the import without deciding');
    data['outcome'] = 'left the import';
    return { summary, data };
  }

  const suggested = new Map(components.map((component) => [component.name, component.aiDecision]));
  const accepted = nameList(decisions.accepted);
  const leftOut = nameList(decisions.rejected);
  const acceptedAgainstAi = nameList(decisions.accepted.filter((name) => suggested.get(name) === 'rejected'));
  const leftOutAgainstAi = nameList(decisions.rejected.filter((name) => suggested.get(name) === 'accepted'));

  summary.push(
    ...nameLines('You accepted', accepted),
    ...nameLines('You left out', leftOut),
    ...nameLines('Accepted although the AI rejected', acceptedAgainstAi),
    ...nameLines('Left out although the AI accepted', leftOutAgainstAi),
    'Outcome: continued',
  );
  Object.assign(data, {
    outcome: 'continued',
    accepted,
    rejected: leftOut,
    accepted_although_ai_rejected: acceptedAgainstAi,
    not_accepted_although_ai_accepted: leftOutAgainstAi,
  });
  return { summary, data };
}

/** The log for a gate that never opened, because the components could not be read. */
export function scopeGateLoadFailureLog(
  sessionId: string,
  message: string,
): { summary: string[]; data: Record<string, unknown> } {
  return {
    summary: [`Session: ${sessionId}`, `Could not read the extracted components: ${message}`],
    data: { session_id: sessionId, outcome: 'could not load the components', error: message },
  };
}
