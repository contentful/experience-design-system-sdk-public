import {
  ExploreCompanionSchema,
  CANDIDATE_FREE_SCOPES,
  type ExploreScope,
  type ExploreCompanion,
  type KnownComponent,
  validateRepresentationProposalSource,
  validateDiscriminatedUnionSourceDefinition,
  validateSourceValue,
  cdfToTarget,
  own,
} from '@contentful/experience-design-system-types';
import type { SlotCandidates, ExploreRepresentationProposalSource } from '../types.js';
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
  proposalSources?: readonly ExploreRepresentationProposalSource[],
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
    for (const prop of component.props ?? []) {
      const source = proposalSources
        ?.find((source) => source.component === component.name && source.source === component.source)
        ?.properties.find((property) => property.identity.key === prop.name);
      if (prop.definition) {
        const root = source?.source.graph.nodes.find((node) => node.id === source.identity.nodeId);
        if (!source || !root || root.required !== (prop.definition.$required ?? false))
          throw new Error(`Union requires exact current compiler source for ${component.name}.${prop.name}`);
        const issues = validateDiscriminatedUnionSourceDefinition(cdfToTarget(prop.definition), source.source.graph);
        if (own(prop, 'default'))
          issues.push(
            ...validateSourceValue(
              source.source.graph,
              prop.default as import('@contentful/experience-design-system-types').JsonValue,
            ),
          );
        if (issues.length)
          throw new Error(
            `Invalid union source for ${component.name}.${prop.name}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
          );
      }
      if (!prop.representationProposal) continue;
      if (!source) throw new Error(`Current source evidence missing for ${component.name}.${prop.name} proposal`);
      const validation = validateRepresentationProposalSource(prop.representationProposal, source);
      if (!validation.valid)
        throw new Error(
          `Invalid representation proposal for ${component.name}.${prop.name}: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
        );
    }
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
  proposalSources?: readonly ExploreRepresentationProposalSource[],
): ParsedExploreOutput {
  try {
    const fences = [...output.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
    const last = fences.at(-1);
    const companion = parseCompanion(last ? last[1]! : output, scope, candidates, requestedComponents, proposalSources);
    return { ok: true, report: last ? output.slice(0, last.index).trim() : '', companion };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
