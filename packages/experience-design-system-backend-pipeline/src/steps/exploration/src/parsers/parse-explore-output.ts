import {
  ExploreCompanionSchema,
  CANDIDATE_FREE_SCOPES,
  type ExploreScope,
  type ExploreCompanion,
  type KnownComponent,
} from '@contentful/experience-design-system-types';
import type { SlotCandidates } from '../types.js';
import { assertUnique } from '../helpers/identity.js';
export function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return JSON.parse(fence ? fence[1]! : trimmed);
}
export function unansweredSlotCandidates(
  components: ExploreCompanion['components'],
  candidates: SlotCandidates = [],
): string[] {
  return candidates.flatMap((candidate) => {
    const report = components.find(
      (component) => component.name === candidate.component && component.source === candidate.source,
    );
    if (!report?.included) return [];
    return candidate.slots
      .filter((name) => !report.slots?.some((slot) => slot.name === name))
      .map((name) => `${candidate.component}:${name}`);
  });
}
function parseCompanion(
  output: string,
  scope: ExploreScope,
  candidates: SlotCandidates = [],
  requestedComponents?: readonly KnownComponent[],
): ExploreCompanion {
  const companion = ExploreCompanionSchema.parse(parseJsonOutput(output));
  if (companion.agentRole !== scope) throw new Error('Exploration scope mismatch');
  assertUnique(
    companion.components.map((component) => JSON.stringify([component.name, component.source])),
    'report components',
  );
  if (requestedComponents) {
    assertUnique(
      requestedComponents.map((component) => JSON.stringify([component.name, component.source])),
      'requested components',
    );
    if (
      companion.components.length !== requestedComponents.length ||
      companion.components.some(
        (component) =>
          !requestedComponents.some(
            (requested) =>
              requested.name === component.name &&
              requested.source === component.source &&
              (requested.componentId === undefined || requested.componentId === component.componentId),
          ),
      )
    )
      throw new Error('Exploration report must exactly cover assigned component/source identities');
  }
  for (const component of companion.components) {
    assertUnique(
      (component.props ?? []).map((prop) => prop.name),
      'reported properties',
    );
    assertUnique(
      (component.slots ?? []).map((slot) => slot.name),
      'reported slots',
    );
    for (const slot of component.slots ?? [])
      if (slot.isRealSlot && !slot.evidence?.some((evidence) => evidence.trim()))
        throw new Error('True slot evidence missing');
    if (scope.startsWith('components-') && typeof component.included !== 'boolean')
      throw new Error('Component inclusion ruling missing');
  }
  if (
    !(CANDIDATE_FREE_SCOPES as readonly string[]).includes(scope) &&
    unansweredSlotCandidates(companion.components, candidates).length
  )
    throw new Error('Unanswered slot candidates');
  return companion;
}

export type ParsedExploreOutput =
  | { ok: true; report: string; companion: ExploreCompanion }
  | { ok: false; error: string };
export function parseExploreOutput(
  output: string,
  scope: ExploreScope,
  candidates: SlotCandidates = [],
  requestedComponents?: readonly KnownComponent[],
): ParsedExploreOutput {
  try {
    const fences = [...output.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
    const last = fences.at(-1);
    const companion = parseCompanion(last ? last[1]! : output, scope, candidates, requestedComponents);
    return { ok: true, report: last ? output.slice(0, last.index).trim() : '', companion };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
