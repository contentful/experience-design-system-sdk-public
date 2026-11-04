import {
  ExploreCompanionSchema,
  CANDIDATE_FREE_SCOPES,
  type ExploreScope,
  type ExploreCompanion,
  type KnownComponent,
  validateRepresentationProposalSource,
  validateDiscriminatedUnionSourceDefinition,
  validateSourceValue,
  validatePropertyDecisionMetadata,
  cdfToTarget,
  own,
} from '@contentful/experience-design-system-types';
import type { SlotCandidates, ExploreRepresentationProposalSource } from '../types.js';
import { assertUnique } from '../helpers/identity.js';
import { explorationCoverageDiagnostic, explorationIssueSubject } from '../helpers/exploration-diagnostics.js';
export function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return JSON.parse(fence ? fence[1]! : trimmed);
}
/** A single prose note has the same meaning as a one-item list; decisions stay strict. */
function normalizeModelingNotes(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('components' in value) || !Array.isArray(value.components)) return value;
  return {
    ...value,
    components: value.components.map((component: unknown) =>
      component &&
      typeof component === 'object' &&
      'modelingNotes' in component &&
      typeof component.modelingNotes === 'string'
        ? { ...component, modelingNotes: [component.modelingNotes] }
        : component,
    ),
  };
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
  const value = normalizeModelingNotes(parseJsonOutput(output));
  if (
    value &&
    typeof value === 'object' &&
    (!('components' in value) || (Array.isArray(value.components) && value.components.length === 0))
  ) {
    const blocker = 'blocker' in value ? value.blocker : 'error' in value ? value.error : undefined;
    if (typeof blocker === 'string' && blocker.trim())
      throw new Error(`Exploration agent reported blocker: ${blocker.trim()}`);
  }
  const parsed = ExploreCompanionSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `Invalid exploration report: ${parsed.error.issues.map((issue) => `${explorationIssueSubject(value, issue.path)}: ${issue.message}`).join('; ')}`,
    );
  const companion = parsed.data;
  if (companion.agentRole !== scope)
    throw new Error(`Exploration scope mismatch: expected ${scope}; received ${companion.agentRole}`);
  assertUnique(
    companion.components.map((component) => JSON.stringify([component.name, component.source])),
    'report components',
  );
  if (requestedComponents) {
    assertUnique(
      requestedComponents.map((component) => JSON.stringify([component.name, component.source])),
      'requested components',
    );
    const coverageError = explorationCoverageDiagnostic(requestedComponents, companion.components);
    if (coverageError) throw new Error(coverageError);
  }
  for (const component of companion.components) {
    const owners = proposalSources?.filter(
      (source) => source.component === component.name && source.source === component.source,
    );
    if (owners && (component.props?.length ?? 0) > 0 && owners.length !== 1)
      throw new Error(`Detail decisions require one exact current component/source owner for ${component.name}`);
    assertUnique(
      (component.props ?? []).map((prop) => prop.name),
      `reported properties for ${component.name} (${component.source})`,
    );
    assertUnique(
      (component.slots ?? []).map((slot) => slot.name),
      `reported slots for ${component.name} (${component.source})`,
    );
    for (const prop of component.props ?? []) {
      const sources = owners?.flatMap((owner) =>
        owner.properties.filter((property) => property.identity.key === prop.name),
      );
      if ((sources?.length ?? 0) > 1)
        throw new Error(`Ambiguous current property source for ${component.name}.${prop.name}`);
      const source = sources?.[0];
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
      if (prop.representationProposal) {
        if (!source) throw new Error(`Current source evidence missing for ${component.name}.${prop.name} proposal`);
        const validation = validateRepresentationProposalSource(prop.representationProposal, source);
        if (!validation.valid)
          throw new Error(
            `Invalid representation proposal for ${component.name}.${prop.name}: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
          );
        if (own(prop, 'default')) {
          const defaultValidation = validateRepresentationProposalSource(
            {
              ...prop.representationProposal,
              desiredDefinition: { ...prop.representationProposal.desiredDefinition, defaultValue: prop.default },
            },
            source,
          );
          if (!defaultValidation.valid)
            throw new Error(
              `Invalid proposal default for ${component.name}.${prop.name}: ${defaultValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
            );
          const issues = validateSourceValue(
            source.source.graph,
            prop.default as import('@contentful/experience-design-system-types').JsonValue,
          );
          if (issues.length)
            throw new Error(`Proposal default contradicts current source for ${component.name}.${prop.name}`);
        }
      }
      const issues = validatePropertyDecisionMetadata(prop, {
        definition: prop.definition,
        representationProposal: prop.representationProposal,
        sourceRequired: source?.source.graph.nodes.find((node) => node.id === source.identity.nodeId)?.required,
      });
      if (issues.length)
        throw new Error(
          `Invalid property decision for ${component.name}.${prop.name}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
        );
    }
    for (const slot of component.slots ?? [])
      if (slot.isRealSlot && !slot.evidence?.some((evidence) => evidence.trim()))
        throw new Error(`True slot evidence missing: ${component.name}:${slot.name} (${component.source})`);
    if (scope.startsWith('components-') && typeof component.included !== 'boolean')
      throw new Error(`Component inclusion ruling missing: ${component.name} (${component.source})`);
  }
  const unanswered = (CANDIDATE_FREE_SCOPES as readonly string[]).includes(scope)
    ? []
    : candidates.flatMap((candidate) =>
        unansweredSlotCandidates(companion.components, [candidate]).map((name) => `${name} (${candidate.source})`),
      );
  if (unanswered.length) throw new Error(`Unanswered slot candidates: ${unanswered.join('; ')}`);
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
