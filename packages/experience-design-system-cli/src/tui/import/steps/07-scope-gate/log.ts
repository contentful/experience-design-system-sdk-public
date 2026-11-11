import type { ScopeComponent, ScopeDecisions } from './types.js';

// What the debug log says about the Scope gate. Only names and counts are stored. The point of the log is to show where
// the user's decision differs from the AI's suggestion, since that is where a component "goes missing".

// A big project must not make the log grow without bound.
const MAX_NAMES = 20;

const capped = (names: string[]): { count: number; names: string[] } => {
  const unique = [...new Set(names)];
  return { count: unique.length, names: unique.slice(0, MAX_NAMES) };
};

/** A count and its names as Summary lines: `Label: 2`, then the names as sub-points, and how many were left out. */
function namedLines(label: string, { count, names }: { count: number; names: string[] }): string[] {
  return [
    `${label}: ${count}`,
    ...names.map((name) => `  ${name}`),
    ...(count > names.length ? [`  …and ${count - names.length} more`] : []),
  ];
}

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

  const summary = [
    `Components found: ${components.length}`,
    `The AI suggested: ${ai.accepted} accept, ${ai.rejected} reject, ${ai.failed} failed, ${ai.none} no suggestion`,
    `Needing review: ${needsReview}`,
    `Tokens in the project: ${tokenCount}`,
  ];
  const data: Record<string, unknown> = {
    components_found: components.length,
    ai_suggestions: ai,
    needs_review: needsReview,
    tokens: tokenCount,
  };

  if (decisions === null) {
    summary.push('Outcome: left the import without deciding');
    data['outcome'] = 'left the import';
    return { summary, data };
  }

  const suggested = new Map(components.map((component) => [component.name, component.aiDecision]));
  const acceptedAgainstAi = capped(decisions.accepted.filter((name) => suggested.get(name) === 'rejected'));
  const leftOutAgainstAi = capped(decisions.rejected.filter((name) => suggested.get(name) === 'accepted'));
  const accepted = new Set(decisions.accepted).size;
  const rejected = new Set(decisions.rejected).size;

  summary.push(
    `You accepted ${accepted} and left out ${rejected}`,
    ...namedLines('Accepted although the AI rejected', acceptedAgainstAi),
    ...namedLines('Left out although the AI accepted', leftOutAgainstAi),
    'Outcome: continued',
  );
  Object.assign(data, {
    outcome: 'continued',
    accepted,
    rejected,
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
